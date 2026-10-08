import { Transaction } from 'sequelize';
import { Discount } from '../../domain/discount';
import { OrganizationTrial } from '../../domain/trial';
import {
  DiscountRedemption,
  DiscountRedemptionRepository,
  DiscountRepository,
  OrganizationTrialRepository,
} from '../../domain/repositories';
import { DiscountModel, DiscountPluginModel, DiscountRedemptionModel, OrganizationTrialModel } from './discount-models';

function toDiscount(row: DiscountModel, pluginCodes: string[]): Discount {
  return Discount.fromPersistence({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    value: Number(row.value),
    fixedAppliesTo: row.fixed_applies_to,
    pluginCodes,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    maxRedemptions: row.max_redemptions,
    redemptionCount: Number(row.redemption_count),
    perOrganizationLimit: Number(row.per_organization_limit),
    organizationId: row.organization_id,
    durationMonths: row.duration_months,
    isActive: Boolean(row.is_active),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function hydrate(rows: DiscountModel[], tx?: Transaction): Promise<Discount[]> {
  if (rows.length === 0) return [];
  const links = await DiscountPluginModel.findAll({
    where: { discount_id: rows.map((r) => r.id) },
    transaction: tx,
  });
  const byDiscount = new Map<string, string[]>();
  for (const l of links) {
    const list = byDiscount.get(l.discount_id) ?? [];
    list.push(l.plugin_code);
    byDiscount.set(l.discount_id, list);
  }
  return rows.map((r) => toDiscount(r, (byDiscount.get(r.id) ?? []).sort()));
}

export function discountRepository(tx?: Transaction): DiscountRepository {
  return {
    async findByCode(code) {
      const row = await DiscountModel.findOne({ where: { code: Discount.normalizeCode(code) }, transaction: tx });
      return row ? (await hydrate([row], tx))[0] : null;
    },

    async findByCodeForUpdate(code) {
      const row = await DiscountModel.findOne({
        where: { code: Discount.normalizeCode(code) },
        transaction: tx,
        // Sin transacción no hay dónde sostener el candado: se lee normal.
        lock: tx ? tx.LOCK.UPDATE : undefined,
      });
      return row ? (await hydrate([row], tx))[0] : null;
    },

    async findById(id) {
      const row = await DiscountModel.findByPk(id, { transaction: tx });
      return row ? (await hydrate([row], tx))[0] : null;
    },

    async list() {
      const rows = await DiscountModel.findAll({ order: [['created_at', 'DESC']], transaction: tx });
      return hydrate(rows, tx);
    },

    async save(discount) {
      const p = discount.toJSON();
      await DiscountModel.upsert(
        {
          id: p.id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          value: p.value,
          fixed_applies_to: p.fixedAppliesTo,
          valid_from: p.validFrom,
          valid_until: p.validUntil,
          max_redemptions: p.maxRedemptions,
          redemption_count: p.redemptionCount,
          per_organization_limit: p.perOrganizationLimit,
          organization_id: p.organizationId,
          duration_months: p.durationMonths,
          is_active: p.isActive,
          created_by_user_id: p.createdByUserId,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        },
        { transaction: tx },
      );
      // El alcance se reemplaza entero: es una lista corta que solo se escribe al crear.
      await DiscountPluginModel.destroy({ where: { discount_id: p.id }, transaction: tx });
      if (p.pluginCodes.length > 0) {
        await DiscountPluginModel.bulkCreate(
          p.pluginCodes.map((plugin_code) => ({ discount_id: p.id, plugin_code })),
          { transaction: tx },
        );
      }
    },
  };
}

function toRedemption(row: DiscountRedemptionModel): DiscountRedemption {
  return {
    id: row.id,
    discountId: row.discount_id,
    organizationId: row.organization_id,
    pluginCode: row.plugin_code,
    redeemedByUserId: row.redeemed_by_user_id,
    listCents: Number(row.list_cents),
    discountCents: Number(row.discount_cents),
    finalCents: Number(row.final_cents),
    redeemedAt: row.redeemed_at,
    expiresAt: row.expires_at,
  };
}

export function discountRedemptionRepository(tx?: Transaction): DiscountRedemptionRepository {
  return {
    async countByOrganization(discountId, organizationId) {
      return DiscountRedemptionModel.count({
        where: { discount_id: discountId, organization_id: organizationId },
        transaction: tx,
      });
    },

    async add(r) {
      await DiscountRedemptionModel.create(
        {
          id: r.id,
          discount_id: r.discountId,
          organization_id: r.organizationId,
          plugin_code: r.pluginCode,
          redeemed_by_user_id: r.redeemedByUserId,
          list_cents: r.listCents,
          discount_cents: r.discountCents,
          final_cents: r.finalCents,
          redeemed_at: r.redeemedAt,
          expires_at: r.expiresAt,
        },
        { transaction: tx },
      );
    },

    async listByOrganization(organizationId) {
      const rows = await DiscountRedemptionModel.findAll({
        where: { organization_id: organizationId },
        order: [['redeemed_at', 'DESC']],
        transaction: tx,
      });
      return rows.map(toRedemption);
    },
  };
}

export function organizationTrialRepository(tx?: Transaction): OrganizationTrialRepository {
  const toTrial = (row: OrganizationTrialModel) =>
    OrganizationTrial.fromPersistence({
      organizationId: row.organization_id,
      startedAt: row.started_at,
      endsAt: row.ends_at,
      startedByUserId: row.started_by_user_id,
    });

  return {
    async find(organizationId) {
      const row = await OrganizationTrialModel.findByPk(organizationId, { transaction: tx });
      return row ? toTrial(row) : null;
    },

    async insertIfAbsent(trial) {
      // findOrCreate se apoya en la clave primaria: dos ingresos simultáneos del administrador crean UNA sola prueba.
      const [, created] = await OrganizationTrialModel.findOrCreate({
        where: { organization_id: trial.organizationId },
        defaults: {
          organization_id: trial.organizationId,
          started_at: trial.startedAt,
          ends_at: trial.endsAt,
          started_by_user_id: trial.startedByUserId,
          created_at: new Date(),
        },
        transaction: tx,
      });
      return created;
    },
  };
}
