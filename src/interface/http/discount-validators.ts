import { z } from 'zod';

/** Fecha ISO 8601 → Date. `null` borra la fecha. */
const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Usa una fecha ISO 8601, por ejemplo 2026-12-31T23:59:59-05:00.' })
  .transform((v) => new Date(v));

const discountFields = {
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  validFrom: isoDate.nullable().optional(),
  validUntil: isoDate.nullable().optional(),
  maxRedemptions: z.number().int().positive('El tope de canjes debe ser mayor que cero.').nullable().optional(),
  perOrganizationLimit: z.number().int().positive('El tope por organización debe ser mayor que cero.').optional(),
};

/**
 * Crear un descuento. El valor se manda en una sola de dos formas, la que se entiende sola:
 *  - `percent`: 15 para un 15 % (hasta dos decimales).
 *  - `amountCents`: 500 para 5,00 USD de descuento.
 */
export const createDiscountSchema = z
  .object({
    ...discountFields,
    code: z.string().trim().min(3, 'El código lleva al menos 3 caracteres.').max(40),
    percent: z.number().min(0.01, 'El porcentaje mínimo es 0,01.').max(100, 'El porcentaje máximo es 100.').optional(),
    amountCents: z.number().int().positive('El monto debe ser mayor que cero.').optional(),
    pluginCodes: z.array(z.string().min(1)).max(100).optional(),
    organizationId: z.string().uuid().nullable().optional(),
    durationMonths: z.number().int().positive('La duración debe ser de al menos 1 mes.').nullable().optional(),
  })
  .refine((v) => (v.percent === undefined) !== (v.amountCents === undefined), {
    message: 'Manda `percent` o `amountCents`, pero no los dos ni ninguno.',
    path: ['percent'],
  })
  .transform((v) => {
    const { percent, amountCents, ...rest } = v;
    return percent !== undefined
      ? { ...rest, kind: 'percent' as const, value: Math.round(percent * 100) }
      : { ...rest, kind: 'fixed' as const, value: amountCents as number };
  });

/** Cambiar un descuento ya creado. El código, el tipo y el valor no se cambian: ya hay quien los vio. */
export const updateDiscountSchema = z.object({
  name: discountFields.name.optional(),
  validFrom: discountFields.validFrom,
  validUntil: discountFields.validUntil,
  maxRedemptions: discountFields.maxRedemptions,
  perOrganizationLimit: discountFields.perOrganizationLimit,
});

export const discountIdParamSchema = z.object({
  id: z.string().uuid('El id del descuento debe ser un UUID válido.'),
});

/** Activar un módulo, opcionalmente con un código. El cuerpo puede venir vacío. */
export const activateWithDiscountSchema = z
  .object({ discountCode: z.string().trim().min(1).max(40).optional() })
  .default({});

export const quoteQuerySchema = z.object({
  discountCode: z.string().trim().min(1).max(40).optional(),
});
