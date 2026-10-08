import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Modulo {
  id: string;
  status: 'hecho' | 'parcial' | 'falta';
  depends_on?: string[];
}

const leer = <T>(archivo: string): T => JSON.parse(readFileSync(join(process.cwd(), 'seed', archivo), 'utf8')) as T;
const catalogo = leer<{ infra_existente: Array<{ id: string }>; modulos: Modulo[] }>('plugins-dependencias.json');
const { precios_cents: precios } = leer<{ precios_cents: Record<string, number> }>('plugins-precios.json');

const nucleo = new Set(catalogo.infra_existente.map((i) => i.id));
const porId = new Map(catalogo.modulos.map((m) => [m.id, m]));

/** Lo que cuesta activar un módulo desde cero: él mismo más todo lo que arrastra (las dependencias del núcleo valen 0). */
function totalDesdeCero(id: string, vistos = new Set<string>()): number {
  if (vistos.has(id) || nucleo.has(id)) return 0;
  vistos.add(id);
  const modulo = porId.get(id);
  const dependencias = (modulo?.depends_on ?? []).reduce((suma, d) => suma + totalDesdeCero(d, vistos), 0);
  return (precios[id] ?? 0) + dependencias;
}

describe('precios de los módulos (seed/plugins-precios.json)', () => {
  it('todo módulo vendible tiene precio, y nada que no exista', () => {
    const sinPrecio = catalogo.modulos.map((m) => m.id).filter((id) => !(id in precios));
    const sinModulo = Object.keys(precios).filter((id) => !porId.has(id));
    expect(sinPrecio, 'módulos sin precio: ' + sinPrecio.join(', ')).toEqual([]);
    expect(sinModulo, 'precios de módulos que no existen: ' + sinModulo.join(', ')).toEqual([]);
  });

  it('los precios son enteros en centavos y no negativos', () => {
    for (const [id, cents] of Object.entries(precios)) {
      expect(Number.isInteger(cents), id).toBe(true);
      expect(cents, id).toBeGreaterThanOrEqual(0);
    }
  });

  it('el núcleo del sistema no se vende: no tiene precio', () => {
    const conPrecio = [...nucleo].filter((id) => id in precios);
    expect(conPrecio).toEqual([]);
  });

  it('un módulo no cuesta menos que lo que arrastra de gratis: ningún precio absurdo (tope 50 USD)', () => {
    for (const [id, cents] of Object.entries(precios)) expect(cents, id).toBeLessThanOrEqual(5000);
  });

  // Los recorridos que un cliente real contrata. Si alguien sube un precio base, estos totales cambian y la prueba obliga a
  // mirar si seguimos por debajo de la competencia (ver `referencias` en el JSON).
  describe('paquetes típicos, sin IVA, por mes', () => {
    it('solo facturar: 9,99 USD (Contífico: 5,99 por 50 facturas, 10,99 por 100; aquí sin tope de documentos)', () => {
      expect(totalDesdeCero('finance.electronic_invoicing')).toBe(999);
    });

    it('facturar + inventario con kardex: menos de 25 USD (Zoho Inventory 29 a 39 USD)', () => {
      const total = totalDesdeCero('finance.electronic_invoicing') + totalDesdeCero('inventory.kardex');
      expect(total).toBe(999 + 499 + 999);
      expect(total).toBeLessThan(2500);
    });

    it('caja completa (POS con cierres, medios de pago, modo sin conexión y promociones) + facturar: menos de 40 USD', () => {
      const vistos = new Set<string>();
      const total = [
        'finance.electronic_invoicing',
        'pos.core',
        'pos.cash_sessions',
        'pos.payment_methods',
        'pos.offline_sync',
        'pos.discounts_promotions',
      ].reduce((suma, id) => suma + totalDesdeCero(id, vistos), 0);
      expect(total).toBeLessThan(4000);
    });

    it('contabilidad completa desde cero (facturar + por cobrar/pagar + libro mayor + reportes): 42,96 USD, por debajo de los 55 USD de Contífico', () => {
      const total = totalDesdeCero('finance.financial_reports');
      expect(total).toBe(4296);
      expect(total).toBeLessThan(5500);
    });
  });
});
