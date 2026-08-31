import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import {
  OrganizationPluginModel,
  OutboxModel,
  PluginCustomRequestModel,
  PluginDependencyModel,
  PluginTranslationModel,
  PluginModel,
} from './models';
import {
  OrganizationPlugin,
  Plugin,
  PluginCustomRequest,
  PluginDependency,
} from '../../domain/entities';
import { PluginDependencyCycleError } from '../../domain/errors';
import {
  DomainEvent,
  OrganizationPluginRepository,
  OutboxRepository,
  PluginCustomRequestRepository,
  PluginDependencyRepository,
  PluginTranslationRepository,
  PluginRepository,
  Repositories,
} from '../../domain/repositories';
import { UnitOfWork } from '../../application/ports';

function toPlugin(m: PluginModel): Plugin {
  return Plugin.fromPersistence({
    id: m.id,
    code: m.code,
    name: m.name,
    category: m.category,
    description: m.description,
    imageUrl: m.image_url,
    buildStatus: m.build_status,
    priceCents: Number(m.price_cents),
    currency: m.currency,
    isActive: m.is_active,
    isCore: m.is_core,
    createdForOrganizationId: m.created_for_organization_id,
    basedOnPluginId: m.based_on_plugin_id,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toPluginDependency(m: PluginDependencyModel): PluginDependency {
  return PluginDependency.fromPersistence({
    pluginId: m.plugin_id,
    dependsOnPluginId: m.depends_on_plugin_id,
    autoActivate: m.auto_activate,
  });
}

function toOrganizationPlugin(m: OrganizationPluginModel): OrganizationPlugin {
  return OrganizationPlugin.fromPersistence({
    organizationId: m.organization_id,
    pluginId: m.plugin_id,
    activationSource: m.activation_source,
    requiredByPluginId: m.required_by_plugin_id,
    status: m.status,
    activatedAt: m.activated_at,
    deactivatedAt: m.deactivated_at,
  });
}

function toPluginCustomRequest(m: PluginCustomRequestModel): PluginCustomRequest {
  return PluginCustomRequest.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    description: m.description,
    basedOnPluginIds: (m.based_on_plugin_ids as string[]) ?? [],
    status: m.status,
    resultingPluginId: m.resulting_plugin_id,
    quotedPriceCents: m.quoted_price_cents === null ? null : Number(m.quoted_price_cents),
    rejectionReason: m.rejection_reason,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function pluginRepository(tx?: Transaction): PluginRepository {
  return {
    async findByCode(code) {
      const m = await PluginModel.findOne({ where: { code }, transaction: tx });
      return m ? toPlugin(m) : null;
    },
    async findById(id) {
      const m = await PluginModel.findByPk(id, { transaction: tx });
      return m ? toPlugin(m) : null;
    },
    async listAll() {
      const ms = await PluginModel.findAll({ order: [['code', 'ASC']], transaction: tx });
      return ms.map(toPlugin);
    },
    async listByCodes(codes) {
      if (codes.length === 0) return [];
      const ms = await PluginModel.findAll({ where: { code: codes }, transaction: tx });
      return ms.map(toPlugin);
    },
    async listVisibleTo(organizationId) {
      const where =
        organizationId === null
          ? { created_for_organization_id: null }
          : {
              [Op.or]: [
                { created_for_organization_id: null },
                { created_for_organization_id: organizationId },
              ],
            };
      const ms = await PluginModel.findAll({ where, order: [['code', 'ASC']], transaction: tx });
      return ms.map(toPlugin);
    },
    async save(plugin) {
      const p = plugin.toPersistence();
      await PluginModel.upsert(
        {
          id: p.id,
          code: p.code,
          name: p.name,
          category: p.category,
          description: p.description,
          image_url: p.imageUrl,
          build_status: p.buildStatus,
          price_cents: p.priceCents,
          currency: p.currency,
          is_active: p.isActive,
          is_core: p.isCore,
          created_for_organization_id: p.createdForOrganizationId,
          based_on_plugin_id: p.basedOnPluginId,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
  };
}

function pluginDependencyRepository(tx?: Transaction): PluginDependencyRepository {
  return {
    async listAll() {
      const ms = await PluginDependencyModel.findAll({ transaction: tx });
      return ms.map(toPluginDependency);
    },
    async listDependenciesOf(pluginId) {
      const ms = await PluginDependencyModel.findAll({ where: { plugin_id: pluginId }, transaction: tx });
      return ms.map(toPluginDependency);
    },
    async listDependentsOf(pluginId) {
      const ms = await PluginDependencyModel.findAll({ where: { depends_on_plugin_id: pluginId }, transaction: tx });
      return ms.map(toPluginDependency);
    },
    async resolveTransitiveDependencies(pluginId) {
      // El grafo es pequeño (<100 aristas): cargarlo completo y resolver en memoria.
      const edges = await PluginDependencyModel.findAll({ transaction: tx });
      const adj = new Map<string, PluginDependency[]>();
      for (const e of edges) {
        const dep = toPluginDependency(e);
        if (!adj.has(dep.pluginId)) adj.set(dep.pluginId, []);
        adj.get(dep.pluginId)!.push(dep);
      }

      const WHITE = 0;
      const GRAY = 1;
      const BLACK = 2;
      const color = new Map<string, number>([[pluginId, WHITE]]);
      const found = new Map<string, PluginDependency>();

      const dfs = (node: string): void => {
        color.set(node, GRAY);
        for (const edge of adj.get(node) ?? []) {
          const c = color.get(edge.dependsOnPluginId) ?? WHITE;
          if (c === GRAY) throw new PluginDependencyCycleError();
          if (c === WHITE) {
            color.set(edge.dependsOnPluginId, WHITE);
            found.set(edge.dependsOnPluginId, edge);
            dfs(edge.dependsOnPluginId);
          }
        }
        color.set(node, BLACK);
      };

      dfs(pluginId);
      return [...found.values()];
    },
  };
}

function organizationPluginRepository(tx?: Transaction): OrganizationPluginRepository {
  return {
    async listByOrganization(organizationId) {
      const ms = await OrganizationPluginModel.findAll({ where: { organization_id: organizationId }, transaction: tx });
      return ms.map(toOrganizationPlugin);
    },
    async find(organizationId, pluginId) {
      const m = await OrganizationPluginModel.findOne({
        where: { organization_id: organizationId, plugin_id: pluginId },
        transaction: tx,
      });
      return m ? toOrganizationPlugin(m) : null;
    },
    async save(op) {
      const p = op.toPersistence();
      await OrganizationPluginModel.upsert(
        {
          organization_id: p.organizationId,
          plugin_id: p.pluginId,
          activation_source: p.activationSource,
          required_by_plugin_id: p.requiredByPluginId,
          status: p.status,
          activated_at: p.activatedAt,
          deactivated_at: p.deactivatedAt,
        },
        { transaction: tx },
      );
    },
    async delete(organizationId, pluginId) {
      await OrganizationPluginModel.destroy({
        where: { organization_id: organizationId, plugin_id: pluginId },
        transaction: tx,
      });
    },
  };
}

function pluginCustomRequestRepository(tx?: Transaction): PluginCustomRequestRepository {
  return {
    async findById(id) {
      const m = await PluginCustomRequestModel.findByPk(id, { transaction: tx });
      return m ? toPluginCustomRequest(m) : null;
    },
    async listByOrganization(organizationId) {
      const ms = await PluginCustomRequestModel.findAll({
        where: { organization_id: organizationId },
        order: [['created_at', 'DESC']],
        transaction: tx,
      });
      return ms.map(toPluginCustomRequest);
    },
    async save(request) {
      const p = request.toPersistence();
      await PluginCustomRequestModel.upsert(
        {
          id: p.id,
          organization_id: p.organizationId,
          description: p.description,
          based_on_plugin_ids: p.basedOnPluginIds,
          status: p.status,
          resulting_plugin_id: p.resultingPluginId,
          quoted_price_cents: p.quotedPriceCents,
          rejection_reason: p.rejectionReason,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
  };
}

function outboxRepository(tx?: Transaction): OutboxRepository {
  return {
    async add(event: DomainEvent) {
      await OutboxModel.create(
        {
          id: randomUUID(),
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          type: event.type,
          payload: event.payload,
          occurred_at: event.occurredAt,
          processed_at: null,
        },
        { transaction: tx },
      );
    },
  };
}

function pluginTranslationRepository(tx?: Transaction): PluginTranslationRepository {
  return {
    async mapByLocale(locale) {
      const ms = await PluginTranslationModel.findAll({ where: { locale }, transaction: tx });
      return new Map(
        ms.map((m) => [
          m.plugin_id,
          {
            pluginId: m.plugin_id,
            name: m.name,
            category: m.category,
            description: m.description,
          },
        ]),
      );
    },
  };
}

export function buildRepositories(tx?: Transaction): Repositories {
  return {
    plugins: pluginRepository(tx),
    translations: pluginTranslationRepository(tx),
    dependencies: pluginDependencyRepository(tx),
    organizationPlugins: organizationPluginRepository(tx),
    customRequests: pluginCustomRequestRepository(tx),
    outbox: outboxRepository(tx),
  };
}

export class SequelizeUnitOfWork implements UnitOfWork {
  async execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return sequelize.transaction(async (tx) => work(buildRepositories(tx)));
  }
}
