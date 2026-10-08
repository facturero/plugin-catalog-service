import { Discount, DiscountResult, PriceLine } from '../domain/discount';
import { DiscountNotFoundError, DiscountRejectedError } from '../domain/errors';
import { DiscountRedemptionRepository, DiscountRepository } from '../domain/repositories';

export interface AppliedDiscount {
  discount: Discount;
  result: DiscountResult;
}

/**
 * Busca un código y comprueba que ESTA organización puede usarlo para ESTAS líneas, y calcula cuánto descuenta.
 * Lo comparten la cotización (que traduce el rechazo en un aviso) y la activación (que lo deja pasar como error).
 *
 * `lock`: en la activación se pide el candado de la fila, para que dos canjes simultáneos no pasen el tope.
 *
 * Un código que no existe y uno que es privado de otra organización responden igual (404): nadie puede averiguar qué
 * códigos existen probando.
 */
export async function resolveDiscount(params: {
  discounts: DiscountRepository;
  redemptions: DiscountRedemptionRepository;
  organizationId: string;
  code: string;
  lines: PriceLine[];
  lock?: boolean;
  now?: Date;
}): Promise<AppliedDiscount> {
  const code = Discount.normalizeCode(params.code);
  const discount = params.lock
    ? await params.discounts.findByCodeForUpdate(code)
    : await params.discounts.findByCode(code);
  if (!discount) throw new DiscountNotFoundError('Ese código no existe.');

  const redeemed = await params.redemptions.countByOrganization(discount.id, params.organizationId);
  const rejection = discount.rejectionFor({
    organizationId: params.organizationId,
    redeemedByOrganization: redeemed,
    now: params.now,
  });
  if (rejection) throw new DiscountRejectedError(rejection);

  // compute() lanza DiscountRejectedError('not_applicable') si ninguna línea tiene precio ni entra en el alcance.
  return { discount, result: discount.compute(params.lines) };
}

/** Cuándo termina el descuento de un canje: N meses desde hoy, o nunca (null). */
export function redemptionExpiry(discount: Discount, from: Date): Date | null {
  if (discount.durationMonths === null) return null;
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + discount.durationMonths);
  return end;
}
