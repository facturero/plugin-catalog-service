import { Discount, DiscountKind } from '../../domain/discount';
import { DiscountCodeAlreadyExistsError, DiscountNotFoundError, ValidationError } from '../../domain/errors';
import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';

export interface DiscountDTO {
  id: string;
  code: string;
  name: string;
  kind: DiscountKind;
  /** percent: puntos básicos (1500 = 15 %). fixed: centavos. */
  value: number;
  /** Lo mismo, legible: 15 para 15 %. Solo en descuentos porcentuales. */
  percent: number | null;
  /** Lo mismo, en centavos. Solo en descuentos de monto fijo. */
  amountCents: number | null;
  pluginCodes: string[];
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  perOrganizationLimit: number;
  organizationId: string | null;
  durationMonths: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toDiscountDTO(d: Discount): DiscountDTO {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    kind: d.kind,
    value: d.value,
    percent: d.kind === 'percent' ? d.value / 100 : null,
    amountCents: d.kind === 'fixed' ? d.value : null,
    pluginCodes: d.pluginCodes,
    validFrom: d.validFrom ? d.validFrom.toISOString() : null,
    validUntil: d.validUntil ? d.validUntil.toISOString() : null,
    maxRedemptions: d.maxRedemptions,
    redemptionCount: d.redemptionCount,
    perOrganizationLimit: d.perOrganizationLimit,
    organizationId: d.organizationId,
    durationMonths: d.durationMonths,
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * Los eventos de administración de descuentos llevan el prefijo `pricing.` y no `plugin.`: el gateway reacciona a todo
 * `plugin.*` recargando los módulos de la organización, y un descuento nuevo no cambia los módulos de nadie. Son eventos
 * de plataforma (sin organizationId, salvo los privados de una organización) y existen para la bitácora de auditoría:
 * regalar o quitar un descuento es dinero.
 */
function eventPayload(d: Discount): Record<string, unknown> {
  return {
    targetId: d.id,
    code: d.code,
    name: d.name,
    kind: d.kind,
    value: d.value,
    pluginCodes: d.pluginCodes,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    maxRedemptions: d.maxRedemptions,
    perOrganizationLimit: d.perOrganizationLimit,
    durationMonths: d.durationMonths,
    ...(d.organizationId ? { organizationId: d.organizationId } : {}),
  };
}

export interface CreateDiscountInput {
  code: string;
  name: string;
  kind: DiscountKind;
  value: number;
  pluginCodes?: string[];
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxRedemptions?: number | null;
  perOrganizationLimit?: number;
  organizationId?: string | null;
  durationMonths?: number | null;
  createdByUserId?: string | null;
}

export class CreateDiscountUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CreateDiscountInput): Promise<DiscountDTO> {
    return this.uow.execute(async (repos: Repositories) => {
      const discount = Discount.create(input);

      if (await repos.discounts.findByCode(discount.code)) {
        throw new DiscountCodeAlreadyExistsError(discount.code);
      }

      // Un código de módulo mal escrito dejaría un descuento que nunca aplica y nadie sabría por qué.
      if (discount.pluginCodes.length > 0) {
        const found = new Set((await repos.plugins.listByCodes(discount.pluginCodes)).map((p) => p.code));
        const unknown = discount.pluginCodes.filter((c) => !found.has(c));
        if (unknown.length > 0) {
          throw new ValidationError(unknown.map((c) => ({ field: 'pluginCodes', message: `El módulo ${c} no existe.` })));
        }
      }

      await repos.discounts.save(discount);
      await repos.outbox.add({
        type: 'pricing.discount.created',
        aggregateType: 'discount',
        aggregateId: discount.id,
        payload: eventPayload(discount),
        occurredAt: new Date(),
      });
      return toDiscountDTO(discount);
    });
  }
}

export interface UpdateDiscountInput {
  id: string;
  name?: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxRedemptions?: number | null;
  perOrganizationLimit?: number;
}

export class UpdateDiscountUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: UpdateDiscountInput): Promise<DiscountDTO> {
    return this.uow.execute(async (repos: Repositories) => {
      const discount = await repos.discounts.findById(input.id);
      if (!discount) throw new DiscountNotFoundError();

      const previous = {
        name: discount.name,
        validFrom: discount.validFrom,
        validUntil: discount.validUntil,
        maxRedemptions: discount.maxRedemptions,
        perOrganizationLimit: discount.perOrganizationLimit,
      };

      const { id: _id, ...changes } = input;
      discount.update(changes);
      await repos.discounts.save(discount);
      await repos.outbox.add({
        type: 'pricing.discount.updated',
        aggregateType: 'discount',
        aggregateId: discount.id,
        payload: { ...eventPayload(discount), previous },
        occurredAt: new Date(),
      });
      return toDiscountDTO(discount);
    });
  }
}

export class SetDiscountActiveUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(id: string, active: boolean): Promise<DiscountDTO> {
    return this.uow.execute(async (repos: Repositories) => {
      const discount = await repos.discounts.findById(id);
      if (!discount) throw new DiscountNotFoundError();

      // Repetir el mismo estado no es un cambio: no ensucia la bitácora.
      if (discount.isActive !== active) {
        if (active) discount.activate();
        else discount.deactivate();
        await repos.discounts.save(discount);
        await repos.outbox.add({
          type: active ? 'pricing.discount.reactivated' : 'pricing.discount.deactivated',
          aggregateType: 'discount',
          aggregateId: discount.id,
          payload: eventPayload(discount),
          occurredAt: new Date(),
        });
      }
      return toDiscountDTO(discount);
    });
  }
}

export class ListDiscountsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(): Promise<DiscountDTO[]> {
    return this.uow.execute(async (repos: Repositories) => (await repos.discounts.list()).map(toDiscountDTO));
  }
}
