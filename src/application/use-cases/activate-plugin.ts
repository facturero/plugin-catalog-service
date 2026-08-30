import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { OrganizationPlugin } from '../../domain/entities';
import {
  CorePluginNotConfigurableError,
  MissingDependenciesError,
  PluginAlreadyActiveError,
  PluginNotAvailableError,
  PluginNotFoundError,
  PluginNotVisibleToOrganizationError,
} from '../../domain/errors';

export class ActivatePluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string, pluginCode: string): Promise<OrganizationPluginDTO[]> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();
      if (!plugin.isVisibleTo(organizationId)) throw new PluginNotVisibleToOrganizationError();
      if (plugin.isCore) throw new CorePluginNotConfigurableError(plugin.code);
      if (!plugin.isBuyable) throw new PluginNotAvailableError(plugin.buildStatus);

      const existing = await repos.organizationPlugins.find(organizationId, plugin.id);
      if (existing?.status === 'active') throw new PluginAlreadyActiveError();

      const transitive = await repos.dependencies.resolveTransitiveDependencies(plugin.id);
      const depIds = [...new Set(transitive.map((d) => d.dependsOnPluginId))];
      const depPlugins = (
        await Promise.all(depIds.map((id) => repos.plugins.findById(id)))
      ).filter((p): p is NonNullable<typeof p> => p !== null);
      const byId = new Map(depPlugins.map((p) => [p.id, p]));

      const missing: string[] = [];
      const toActivate: { pluginId: string; autoActivate: boolean }[] = [];
      for (const d of transitive) {
        const dep = byId.get(d.dependsOnPluginId);
        if (!dep) continue;
        const row = await repos.organizationPlugins.find(organizationId, dep.id);
        if (row?.status === 'active') continue;
        if (!d.autoActivate || !dep.isBuyable) {
          missing.push(dep.code);
          continue;
        }
        toActivate.push({ pluginId: dep.id, autoActivate: true });
      }
      if (missing.length > 0) throw new MissingDependenciesError([...new Set(missing)]);

      const activated: OrganizationPlugin[] = [];
      for (const t of toActivate) {
        const op = OrganizationPlugin.activateAsDependency(organizationId, t.pluginId, plugin.id);
        await repos.organizationPlugins.save(op);
        activated.push(op);
      }

      const direct = OrganizationPlugin.activateDirect(organizationId, plugin.id);
      await repos.organizationPlugins.save(direct);
      activated.push(direct);

      for (const op of activated) {
        const p = op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!;
        await repos.outbox.add({
          type: 'plugin.activated',
          aggregateType: 'plugin',
          aggregateId: op.pluginId,
          payload: {
            organizationId,
            pluginId: op.pluginId,
            code: p.code,
            activationSource: op.activationSource,
            requiredByPluginId: op.requiredByPluginId,
          },
          occurredAt: new Date(),
        });
      }

      return activated.map((op): OrganizationPluginDTO => ({
        organizationId: op.organizationId,
        pluginId: op.pluginId,
        pluginCode: (op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!).code,
        pluginName: (op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!).name,
        activationSource: op.activationSource,
        requiredByPluginId: op.requiredByPluginId,
        status: op.status,
        activatedAt: op.activatedAt,
        deactivatedAt: op.deactivatedAt,
      }));
    });
  }
}
