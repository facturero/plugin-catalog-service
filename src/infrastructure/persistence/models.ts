import { DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from './sequelize';

export class PluginModel extends Model<
  InferAttributes<PluginModel>,
  InferCreationAttributes<PluginModel>
> {
  declare id: string;
  declare code: string;
  declare name: string;
  declare category: string;
  declare description: string;
  declare image_url: string | null;
  declare build_status: 'disponible' | 'en_construccion' | 'descontinuado';
  declare price_cents: number;
  declare currency: string;
  declare is_active: boolean;
  declare is_core: boolean;
  declare created_for_organization_id: string | null;
  declare based_on_plugin_id: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

PluginModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    category: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    build_status: {
      type: DataTypes.ENUM('disponible', 'en_construccion', 'descontinuado'),
      allowNull: false,
      defaultValue: 'disponible',
    },
    price_cents: { type: DataTypes.BIGINT, allowNull: false },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'USD' },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_core: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_for_organization_id: { type: DataTypes.CHAR(36), allowNull: true },
    based_on_plugin_id: { type: DataTypes.CHAR(36), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'plugins', timestamps: false },
);

export class PluginTranslationModel extends Model<
  InferAttributes<PluginTranslationModel>,
  InferCreationAttributes<PluginTranslationModel>
> {
  declare plugin_id: string;
  declare locale: string;
  declare name: string;
  declare category: string;
  declare description: string;
}

PluginTranslationModel.init(
  {
    plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    locale: { type: DataTypes.STRING(5), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    category: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: 'plugin_translations', timestamps: false },
);

export class PluginDependencyModel extends Model<
  InferAttributes<PluginDependencyModel>,
  InferCreationAttributes<PluginDependencyModel>
> {
  declare plugin_id: string;
  declare depends_on_plugin_id: string;
  declare auto_activate: boolean;
}

PluginDependencyModel.init(
  {
    plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    depends_on_plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    auto_activate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, tableName: 'plugin_dependencies', timestamps: false },
);

export class OrganizationPluginModel extends Model<
  InferAttributes<OrganizationPluginModel>,
  InferCreationAttributes<OrganizationPluginModel>
> {
  declare organization_id: string;
  declare plugin_id: string;
  declare activation_source: 'direct' | 'dependency';
  declare required_by_plugin_id: string | null;
  declare status: 'active' | 'disabled';
  declare activated_at: Date;
  declare deactivated_at: Date | null;
}

OrganizationPluginModel.init(
  {
    organization_id: { type: DataTypes.CHAR(36), primaryKey: true },
    plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    activation_source: { type: DataTypes.ENUM('direct', 'dependency'), allowNull: false },
    required_by_plugin_id: { type: DataTypes.CHAR(36), allowNull: true },
    status: { type: DataTypes.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
    activated_at: { type: DataTypes.DATE, allowNull: false },
    deactivated_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'organization_plugins', timestamps: false },
);

export class PluginCustomRequestModel extends Model<
  InferAttributes<PluginCustomRequestModel>,
  InferCreationAttributes<PluginCustomRequestModel>
> {
  declare id: string;
  declare organization_id: string;
  declare description: string;
  declare based_on_plugin_ids: unknown;
  declare status: 'requested' | 'quoted' | 'created' | 'rejected';
  declare resulting_plugin_id: string | null;
  declare quoted_price_cents: number | null;
  declare rejection_reason: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

PluginCustomRequestModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    based_on_plugin_ids: { type: DataTypes.JSON, allowNull: false },
    status: {
      type: DataTypes.ENUM('requested', 'quoted', 'created', 'rejected'),
      allowNull: false,
      defaultValue: 'requested',
    },
    resulting_plugin_id: { type: DataTypes.CHAR(36), allowNull: true },
    quoted_price_cents: { type: DataTypes.BIGINT, allowNull: true },
    rejection_reason: { type: DataTypes.TEXT, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'plugin_custom_requests', timestamps: false },
);

export class OutboxModel extends Model<
  InferAttributes<OutboxModel>,
  InferCreationAttributes<OutboxModel>
> {
  declare id: string;
  declare aggregate_type: string;
  declare aggregate_id: string;
  declare type: string;
  declare payload: unknown;
  declare occurred_at: Date;
  declare processed_at: Date | null;
}

OutboxModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    aggregate_type: { type: DataTypes.STRING(50), allowNull: false },
    aggregate_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(100), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'outbox_messages', timestamps: false },
);

// Asociaciones
PluginModel.hasMany(PluginDependencyModel, { foreignKey: 'plugin_id', as: 'dependencies' });
PluginDependencyModel.belongsTo(PluginModel, { foreignKey: 'plugin_id' });
PluginModel.hasMany(OrganizationPluginModel, { foreignKey: 'plugin_id' });
OrganizationPluginModel.belongsTo(PluginModel, { foreignKey: 'plugin_id' });

// --- Business Profiles ---

export class BusinessProfileModel extends Model<
  InferAttributes<BusinessProfileModel>,
  InferCreationAttributes<BusinessProfileModel>
> {
  declare id: string;
  declare code: string;
  declare name: string;
  declare description: string;
  declare icon: string;
  declare sort_order: number;
  declare is_active: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}

BusinessProfileModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    icon: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'mdi-storefront-outline' },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'business_profiles', timestamps: false },
);

export class BusinessProfilePluginModel extends Model<
  InferAttributes<BusinessProfilePluginModel>,
  InferCreationAttributes<BusinessProfilePluginModel>
> {
  declare business_profile_id: string;
  declare plugin_id: string;
  declare recommendation: 'essential' | 'suggested';
  declare sort_order: number;
}

BusinessProfilePluginModel.init(
  {
    business_profile_id: { type: DataTypes.CHAR(36), primaryKey: true },
    plugin_id: { type: DataTypes.CHAR(36), primaryKey: true },
    recommendation: { type: DataTypes.ENUM('essential', 'suggested'), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { sequelize, tableName: 'business_profile_plugins', timestamps: false },
);

export class BusinessProfileTranslationModel extends Model<
  InferAttributes<BusinessProfileTranslationModel>,
  InferCreationAttributes<BusinessProfileTranslationModel>
> {
  declare business_profile_id: string;
  declare locale: string;
  declare name: string;
  declare description: string;
}

BusinessProfileTranslationModel.init(
  {
    business_profile_id: { type: DataTypes.CHAR(36), primaryKey: true },
    locale: { type: DataTypes.STRING(5), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: 'business_profile_translations', timestamps: false },
);

export class OrganizationBusinessProfileModel extends Model<
  InferAttributes<OrganizationBusinessProfileModel>,
  InferCreationAttributes<OrganizationBusinessProfileModel>
> {
  declare organization_id: string;
  declare business_profile_id: string | null;
  declare status: 'selected' | 'skipped';
  declare decided_by_user_id: string | null;
  declare decided_at: Date;
  declare updated_at: Date;
}

OrganizationBusinessProfileModel.init(
  {
    organization_id: { type: DataTypes.CHAR(36), primaryKey: true },
    business_profile_id: { type: DataTypes.CHAR(36), allowNull: true },
    status: { type: DataTypes.ENUM('selected', 'skipped'), allowNull: false, defaultValue: 'selected' },
    decided_by_user_id: { type: DataTypes.CHAR(36), allowNull: true },
    decided_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'organization_business_profiles', timestamps: false },
);

BusinessProfileModel.hasMany(BusinessProfilePluginModel, { foreignKey: 'business_profile_id' });
BusinessProfilePluginModel.belongsTo(BusinessProfileModel, { foreignKey: 'business_profile_id' });
