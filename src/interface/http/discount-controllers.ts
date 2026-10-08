import { Context } from 'hono';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from '../../application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from '../../application/use-cases/list-my-discount-redemptions';
import { GetSubscriptionUseCase } from '../../application/use-cases/get-subscription';
import { ContextVariables } from './middlewares';

type Ctx = Context<{ Variables: ContextVariables }>;

export function listDiscountsController(useCase: ListDiscountsUseCase) {
  return async (c: Ctx) => c.json(await useCase.execute(), 200);
}

export function createDiscountController(useCase: CreateDiscountUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as Parameters<CreateDiscountUseCase['execute']>[0];
    const result = await useCase.execute({ ...body, createdByUserId: c.get('userId') ?? null });
    return c.json(result, 201);
  };
}

export function updateDiscountController(useCase: UpdateDiscountUseCase) {
  return async (c: Ctx) => {
    const { id } = c.req.valid('param' as never) as { id: string };
    const body = c.req.valid('json' as never) as Omit<Parameters<UpdateDiscountUseCase['execute']>[0], 'id'>;
    return c.json(await useCase.execute({ id, ...body }), 200);
  };
}

export function setDiscountActiveController(useCase: SetDiscountActiveUseCase, active: boolean) {
  return async (c: Ctx) => {
    const { id } = c.req.valid('param' as never) as { id: string };
    return c.json(await useCase.execute(id, active), 200);
  };
}

export function listMyDiscountRedemptionsController(useCase: ListMyDiscountRedemptionsUseCase) {
  return async (c: Ctx) => c.json(await useCase.execute(c.get('organizationId')), 200);
}

/**
 * Estado comercial de la organización (prueba gratis e IVA). Lo llama el frontend al cargar: si quien llama puede gestionar
 * módulos (el administrador) y la prueba no ha empezado, arranca. Cualquier otro usuario solo lee.
 */
export function getSubscriptionController(useCase: GetSubscriptionUseCase) {
  return async (c: Ctx) => {
    const permissions = c.get('permissions') ?? [];
    const result = await useCase.execute({
      organizationId: c.get('organizationId'),
      userId: c.get('userId') ?? null,
      canManagePlugins: permissions.includes('plugins:manage') || permissions.includes('*'),
    });
    return c.json(result, 200);
  };
}
