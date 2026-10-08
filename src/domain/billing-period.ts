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

/**
 * Hasta cuándo estaba pagado un módulo que se desactivó, o null si ya no lo estaba. Un módulo desactivado ANTES de que
 * terminara su periodo pago (o su prueba gratis) sigue siendo del cliente hasta esa fecha: reactivarlo ahí no cuesta nada.
 * Si se desactivó justo al terminar el periodo (la baja programada que se cumple), ya no queda nada pago.
 */
export function paidThroughOfDeactivated(params: {
  activatedAt: Date;
  deactivatedAt: Date;
  trialEndsAt: Date | null;
  now: Date;
}): Date | null {
  // Un instante antes de la baja: así una baja que cae EXACTO en el corte pertenece al periodo que terminaba, no al siguiente.
  // Sin pasar de la propia activación: dar de baja en el mismo instante de activar sigue siendo dentro de su primer periodo.
  const justBefore = new Date(Math.max(params.deactivatedAt.getTime() - 1, params.activatedAt.getTime()));
  const end = currentPeriodEnd({ activatedAt: params.activatedAt, trialEndsAt: params.trialEndsAt, now: justBefore });
  return end.getTime() > params.now.getTime() ? end : null;
}
