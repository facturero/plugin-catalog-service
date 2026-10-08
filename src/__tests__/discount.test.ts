import { describe, expect, it } from 'vitest';
import { Discount } from '../domain/discount';
import { DiscountRejectedError, ValidationError } from '../domain/errors';

const hoy = new Date('2026-10-08T12:00:00Z');

function descuento(params: Partial<Parameters<typeof Discount.create>[0]> = {}): Discount {
  return Discount.create({ code: 'LANZAMIENTO', name: 'Lanzamiento', kind: 'percent', value: 2000, ...params });
}

describe('Discount · cálculo', () => {
  it('porcentaje: 20 % de 20,00 USD son 4,00 USD', () => {
    const r = descuento().compute([{ pluginCode: 'a', priceCents: 2000 }]);
    expect(r.discountCents).toBe(400);
    expect(r.totalCents).toBe(1600);
    expect(r.lines).toEqual([{ pluginCode: 'a', priceCents: 2000, discountCents: 400, finalCents: 1600 }]);
  });

  it('porcentaje: redondea hacia abajo (a favor del cliente nunca se regala un centavo de más)', () => {
    // 15 % de 9,99 = 149,85 centavos → 149
    const r = descuento({ value: 1500 }).compute([{ pluginCode: 'a', priceCents: 999 }]);
    expect(r.discountCents).toBe(149);
    expect(r.totalCents).toBe(850);
  });

  it('monto fijo (por defecto POR MÓDULO): resta 5,00 a cada módulo al mes', () => {
    const r = descuento({ kind: 'fixed', value: 500 }).compute([
      { pluginCode: 'a', priceCents: 2000 },
      { pluginCode: 'b', priceCents: 1000 },
    ]);
    expect(r.lines.map((l) => l.discountCents)).toEqual([500, 500]);
    expect(r.discountCents).toBe(1000);
    expect(r.totalCents).toBe(2000);
  });

  it('monto fijo por módulo: a un módulo más barato que el monto le quita solo lo que cuesta', () => {
    const r = descuento({ kind: 'fixed', value: 500 }).compute([
      { pluginCode: 'a', priceCents: 2000 },
      { pluginCode: 'b', priceCents: 299 },
    ]);
    expect(r.lines).toEqual([
      { pluginCode: 'a', priceCents: 2000, discountCents: 500, finalCents: 1500 },
      { pluginCode: 'b', priceCents: 299, discountCents: 299, finalCents: 0 },
    ]);
    expect(r.totalCents).toBe(1500);
  });

  it("monto fijo «total»: rebaja UNA vez sobre el subtotal elegible", () => {
    const r = descuento({ kind: 'fixed', value: 500, fixedAppliesTo: 'total' }).compute([
      { pluginCode: 'a', priceCents: 2000 },
      { pluginCode: 'b', priceCents: 1000 },
    ]);
    expect(r.discountCents).toBe(500);
    expect(r.totalCents).toBe(2500);
  });

  it('monto fijo por módulo con alcance a ciertos módulos: solo esos', () => {
    const r = descuento({ kind: 'fixed', value: 200, pluginCodes: ['b'] }).compute([
      { pluginCode: 'a', priceCents: 2000 },
      { pluginCode: 'b', priceCents: 1000 },
    ]);
    expect(r.lines.map((l) => l.pluginCode)).toEqual(['b']);
    expect(r.totalCents).toBe(2800);
  });

  it('monto fijo mayor que el precio: nunca deja un total negativo', () => {
    const r = descuento({ kind: 'fixed', value: 99999 }).compute([{ pluginCode: 'a', priceCents: 499 }]);
    expect(r.discountCents).toBe(499);
    expect(r.totalCents).toBe(0);
  });

  it('el reparto entre líneas suma exactamente el descuento, sin centavos perdidos', () => {
    const lines = [
      { pluginCode: 'a', priceCents: 999 },
      { pluginCode: 'b', priceCents: 499 },
      { pluginCode: 'c', priceCents: 299 },
    ];
    for (const value of [1, 333, 1234, 3333, 9999, 10000]) {
      const r = descuento({ value }).compute(lines);
      expect(r.lines.reduce((s, l) => s + l.discountCents, 0), `value=${value}`).toBe(r.discountCents);
      expect(r.totalCents).toBe(1797 - r.discountCents);
      for (const l of r.lines) expect(l.finalCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('con alcance a ciertos módulos, el resto paga precio de lista', () => {
    const r = descuento({ pluginCodes: ['b'], value: 5000 }).compute([
      { pluginCode: 'a', priceCents: 2000 },
      { pluginCode: 'b', priceCents: 1000 },
    ]);
    expect(r.discountCents).toBe(500);
    expect(r.lines.map((l) => l.pluginCode)).toEqual(['b']);
    expect(r.totalCents).toBe(2500);
  });

  it('lo que no cuesta nada (precio 0) no se descuenta ni cuenta como elegible', () => {
    const r = descuento().compute([
      { pluginCode: 'base', priceCents: 0 },
      { pluginCode: 'a', priceCents: 1000 },
    ]);
    expect(r.lines.map((l) => l.pluginCode)).toEqual(['a']);
    expect(r.subtotalCents).toBe(1000);
  });

  it('si ninguna línea entra en el alcance, el código «no aplica»', () => {
    expect(() => descuento({ pluginCodes: ['z'] }).compute([{ pluginCode: 'a', priceCents: 1000 }])).toThrow(
      DiscountRejectedError,
    );
    expect(() => descuento().compute([{ pluginCode: 'base', priceCents: 0 }])).toThrow(DiscountRejectedError);
  });
});

describe('Discount · cuándo se puede usar', () => {
  const ok = { organizationId: 'org-1', redeemedByOrganization: 0, now: hoy };

  it('un descuento recién creado se puede usar', () => {
    expect(descuento().rejectionFor(ok)).toBeNull();
  });

  it('desactivado', () => {
    const d = descuento();
    d.deactivate();
    expect(d.rejectionFor(ok)).toBe('inactive');
  });

  it('antes y después de su vigencia', () => {
    const d = descuento({ validFrom: new Date('2026-11-01T00:00:00Z'), validUntil: new Date('2026-12-01T00:00:00Z') });
    expect(d.rejectionFor(ok)).toBe('not_started');
    expect(d.rejectionFor({ ...ok, now: new Date('2026-11-15T00:00:00Z') })).toBeNull();
    expect(d.rejectionFor({ ...ok, now: new Date('2026-12-02T00:00:00Z') })).toBe('expired');
  });

  it('tope global de canjes', () => {
    const d = descuento({ maxRedemptions: 2 });
    d.registerRedemption();
    expect(d.rejectionFor(ok)).toBeNull();
    d.registerRedemption();
    expect(d.rejectionFor(ok)).toBe('exhausted');
  });

  it('tope por organización (1 por defecto)', () => {
    expect(descuento().rejectionFor({ ...ok, redeemedByOrganization: 1 })).toBe('already_redeemed');
    expect(descuento({ perOrganizationLimit: 3 }).rejectionFor({ ...ok, redeemedByOrganization: 2 })).toBeNull();
  });

  it('privado de otra organización', () => {
    expect(descuento({ organizationId: 'org-2' }).rejectionFor(ok)).toBe('other_organization');
    expect(descuento({ organizationId: 'org-1' }).rejectionFor(ok)).toBeNull();
  });
});

describe('Discount · validación al crear', () => {
  it('normaliza el código (mayúsculas, sin espacios alrededor)', () => {
    expect(descuento({ code: '  lanzamiento-2026 ' }).code).toBe('LANZAMIENTO-2026');
  });

  it('rechaza valores imposibles', () => {
    expect(() => descuento({ value: 0 })).toThrow(ValidationError);
    expect(() => descuento({ value: 10001 })).toThrow(ValidationError);
    expect(() => descuento({ kind: 'fixed', value: 0 })).toThrow(ValidationError);
    expect(() => descuento({ kind: 'fixed', value: 12.5 })).toThrow(ValidationError);
  });

  it('rechaza códigos mal formados y fechas al revés', () => {
    expect(() => descuento({ code: 'ab' })).toThrow(ValidationError);
    expect(() => descuento({ code: 'con espacios' })).toThrow(ValidationError);
    expect(() =>
      descuento({ validFrom: new Date('2026-12-01'), validUntil: new Date('2026-11-01') }),
    ).toThrow(ValidationError);
  });

  it('rechaza topes y duraciones que no son enteros positivos', () => {
    expect(() => descuento({ maxRedemptions: 0 })).toThrow(ValidationError);
    expect(() => descuento({ perOrganizationLimit: 0 })).toThrow(ValidationError);
    expect(() => descuento({ durationMonths: 0 })).toThrow(ValidationError);
  });
});
