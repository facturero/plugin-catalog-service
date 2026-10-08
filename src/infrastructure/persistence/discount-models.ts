import { DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from './sequelize';

export class DiscountModel extends Model<InferAttributes<DiscountModel>, InferCreationAttributes<DiscountModel>> {
  declare id: string;
  declare code: string;
  declare name: string;
  declare kind: 'percent' | 'fixed';
  declare value: number;
  declare valid_from: Date | null;
  declare valid_until: Date | null;
  declare max_redemptions: number | null;
  declare redemption_count: number;
  declare per_organization_limit: number;
  declare organization_id: string | null;
  declare duration_months: number | null;
  declare is_active: boolean;
  declare created_by_user_id: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

DiscountModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    code: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    kind: { type: DataTypes.ENUM('percent', 'fixed'), allowNull: false },
    value: { type: DataTypes.INTEGER, allowNull: false },
    valid_from: { type: DataTypes.DATE, allowNull: true },
    valid_until: { type: DataTypes.DATE, allowNull: true },
    max_redemptions: { type: DataTypes.INTEGER, allowNull: true },
    redemption_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    per_organization_limit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    organization_id: { type: DataTypes.CHAR(36), allowNull: true },
    duration_months: { type: DataTypes.INTEGER, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by_user_id: { type: DataTypes.CHAR(36), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: 'discounts', timestamps: false },
);

export class DiscountPluginModel extends Model<
  InferAttributes<DiscountPluginModel>,
  InferCreationAttributes<DiscountPluginModel>
> {
  declare discount_id: string;
  declare plugin_code: string;
}

DiscountPluginModel.init(
  {
    discount_id: { type: DataTypes.CHAR(36), primaryKey: true },
    plugin_code: { type: DataTypes.STRING(100), primaryKey: true },
  },
  { sequelize, tableName: 'discount_plugins', timestamps: false },
);

export class DiscountRedemptionModel extends Model<
  InferAttributes<DiscountRedemptionModel>,
  InferCreationAttributes<DiscountRedemptionModel>
> {
  declare id: string;
  declare discount_id: string;
  declare organization_id: string;
  declare plugin_code: string;
  declare redeemed_by_user_id: string | null;
  declare list_cents: number;
  declare discount_cents: number;
  declare final_cents: number;
  declare redeemed_at: Date;
  declare expires_at: Date | null;
}

DiscountRedemptionModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    discount_id: { type: DataTypes.CHAR(36), allowNull: false },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    plugin_code: { type: DataTypes.STRING(100), allowNull: false },
    redeemed_by_user_id: { type: DataTypes.CHAR(36), allowNull: true },
    list_cents: { type: DataTypes.BIGINT, allowNull: false },
    discount_cents: { type: DataTypes.BIGINT, allowNull: false },
    final_cents: { type: DataTypes.BIGINT, allowNull: false },
    redeemed_at: { type: DataTypes.DATE, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'discount_redemptions', timestamps: false },
);
