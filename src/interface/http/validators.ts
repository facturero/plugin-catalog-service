import { zValidator } from '@hono/zod-validator';
import { z, ZodSchema } from 'zod';
import { ValidationError } from '../../domain/errors';

export const pluginCodeParamSchema = z.object({
  code: z.string().min(1, 'El código del plugin es obligatorio.'),
});

export const requestIdParamSchema = z.object({
  id: z.string().uuid('El id de la solicitud debe ser un UUID válido.'),
});

export const requestCustomPluginSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria.').max(5000),
  basedOnPluginCodes: z.array(z.string().min(1)).max(20),
});

export const fulfillCustomRequestSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio.').max(255),
  description: z.string().min(1, 'La descripción es obligatoria.').max(5000),
  priceCents: z.number().int().nonnegative('El precio no puede ser negativo.'),
  imageUrl: z.string().url().max(500).nullable().optional(),
  basedOnPluginId: z.string().uuid().nullable().optional(),
});

export const rejectCustomRequestSchema = z.object({
  reason: z.string().min(1, 'La razón es obligatoria.').max(2000),
});

export const businessProfileCodeParamSchema = z.object({
  code: z.string().min(1, 'El código del perfil de negocio es obligatorio.'),
});

export const chooseBusinessProfileSchema = z.object({
  code: z.string().min(1).nullable().optional(),
  source: z.enum(['onboarding', 'settings']).default('onboarding'),
});

export const activatePluginsBatchSchema = z.object({
  codes: z.array(z.string().min(1)).max(50),
});

function validate<T extends ZodSchema>(source: 'json' | 'param', schema: T) {
  return zValidator(source, schema as never, (result) => {
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw new ValidationError(details);
    }
  });
}

export function validateJson<T extends ZodSchema>(schema: T) {
  return validate('json', schema);
}

export function validateParams<T extends ZodSchema>(schema: T) {
  return validate('param', schema);
}
