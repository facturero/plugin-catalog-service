import { Context } from 'hono';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from '../../application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from '../../application/use-cases/list-my-discount-redemptions';
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
