/**
 * Reglas comerciales que no son del módulo: cuánto dura la prueba gratis y qué IVA se suma. Vienen de la configuración
 * del servicio (TRIAL_MONTHS, VAT_BPS) y se pasan a los casos de uso, para que las pruebas las fijen sin tocar el entorno.
 */
export interface PricingPolicy {
  /** Meses de prueba de toda la organización. 0 = sin prueba. */
  trialMonths: number;
  /** IVA en puntos básicos (1500 = 15 %). */
  vatBps: number;
}

export const DEFAULT_PRICING_POLICY: PricingPolicy = { trialMonths: 3, vatBps: 1500 };

/** IVA de un importe en centavos, redondeado al centavo. Se calcula sobre el total, no por línea, para no acumular redondeos. */
export function vatCents(baseCents: number, vatBps: number): number {
  return Math.round((baseCents * vatBps) / 10000);
}
