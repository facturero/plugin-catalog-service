import { addMonths } from './trial';

/**
 * Cuándo termina el periodo mensual que la organización ya tiene pago de un módulo.
 *
 * El periodo se cuenta desde que el módulo empieza a cobrarse: la activación o, si la prueba gratis de la organización
 * termina después, desde el fin de la prueba (durante la prueba nada se cobra, así que el primer periodo pago arranca ahí).
 * Los periodos siguientes se miden siempre desde ese ancla (no encadenados): 31 de enero → 28 de febrero → 31 de marzo.
 * Mientras la prueba corre, el periodo «vigente» es la propia prueba: termina cuando ella termina.
 */
export function currentPeriodEnd(params: { activatedAt: Date; trialEndsAt: Date | null; now: Date }): Date {
  const { activatedAt, trialEndsAt, now } = params;
  const anchor = trialEndsAt && trialEndsAt.getTime() > activatedAt.getTime() ? trialEndsAt : activatedAt;
  if (now.getTime() < anchor.getTime()) return anchor;
  let months = 1;
  while (addMonths(anchor, months).getTime() <= now.getTime()) months++;
  return addMonths(anchor, months);
}
