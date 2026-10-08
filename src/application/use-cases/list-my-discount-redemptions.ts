import { DiscountRedemptionRepository, DiscountRepository } from '../../domain/repositories';

export interface MyDiscountRedemptionDTO {
  id: string;
  discountCode: string;
  discountName: string;
  pluginCode: string;
  listCents: number;
  discountCents: number;
  finalCents: number;
  redeemedAt: string;
  /** null = dura mientras el módulo siga activo. */
  expiresAt: string | null;
  /** ¿Sigue vigente hoy? Un descuento con duración deja de aplicar al vencer. */
  active: boolean;
}

/** Los descuentos que esta organización ya canjeó, con lo que se prometió pagar en cada uno. */
export class ListMyDiscountRedemptionsUseCase {
  constructor(
    private readonly discounts: DiscountRepository,
    private readonly redemptions: DiscountRedemptionRepository,
  ) {}

  async execute(organizationId: string, now: Date = new Date()): Promise<MyDiscountRedemptionDTO[]> {
    const rows = await this.redemptions.listByOrganization(organizationId);
    const out: MyDiscountRedemptionDTO[] = [];
    for (const r of rows) {
      const discount = await this.discounts.findById(r.discountId);
      out.push({
        id: r.id,
        discountCode: discount?.code ?? '',
        discountName: discount?.name ?? '',
        pluginCode: r.pluginCode,
        listCents: r.listCents,
        discountCents: r.discountCents,
        finalCents: r.finalCents,
        redeemedAt: r.redeemedAt.toISOString(),
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
        active: r.expiresAt === null || r.expiresAt > now,
      });
    }
    return out;
  }
}
