import { DataTypes, InferAttributes, InferCreationAttributes, Model, Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import { CartItem, CartRepository } from '../../domain/repositories';

export class OrganizationCartItemModel extends Model<
  InferAttributes<OrganizationCartItemModel>,
  InferCreationAttributes<OrganizationCartItemModel>
> {
  declare organization_id: string;
  declare plugin_id: string;
  declare added_by_user_id: string | null;
  declare added_at: Date;
}

OrganizationCartItemModel.init(
  {
    organization_id: { type: DataTypes.CHAR(36), primaryKey: true },
    plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    added_by_user_id: { type: DataTypes.CHAR(36), allowNull: true },
    added_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: 'organization_cart_items', timestamps: false },
);

export function cartRepository(tx?: Transaction): CartRepository {
  return {
    async list(organizationId) {
      const rows = await OrganizationCartItemModel.findAll({
        where: { organization_id: organizationId },
        order: [['added_at', 'ASC']],
        transaction: tx,
      });
      return rows.map((r): CartItem => ({
        organizationId: r.organization_id,
        pluginId: r.plugin_id,
        addedByUserId: r.added_by_user_id,
        addedAt: r.added_at,
      }));
    },
    async add(item) {
      const [, created] = await OrganizationCartItemModel.findOrCreate({
        where: { organization_id: item.organizationId, plugin_id: item.pluginId },
        defaults: {
          organization_id: item.organizationId,
          plugin_id: item.pluginId,
          added_by_user_id: item.addedByUserId,
          added_at: item.addedAt,
        },
        transaction: tx,
      });
      return created;
    },
    async remove(organizationId, pluginId) {
      const n = await OrganizationCartItemModel.destroy({
        where: { organization_id: organizationId, plugin_id: pluginId },
        transaction: tx,
      });
      return n > 0;
    },
    async clear(organizationId) {
      return OrganizationCartItemModel.destroy({ where: { organization_id: organizationId }, transaction: tx });
    },
  };
}
