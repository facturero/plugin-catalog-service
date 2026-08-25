import { OrganizationPluginDTO } from '../dtos';
import {
  OrganizationPluginRepository,
  PluginRepository,
} from '../../domain/repositories';

export class GetOrganizationPluginsUseCase {
  constructor(
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly plugins: PluginRepository,
  ) {}

  async execute(organizationId: string): Promise<OrganizationPluginDTO[]> {
    const rows = await this.organizationPlugins.listByOrganization(organizationId);
    const uniqueIds = [...new Set(rows.map((r) => r.pluginId))];
    const found = await Promise.all(uniqueIds.map((id) => this.plugins.findById(id)));
    const byId = new Map(found.filter((p) => p !== null).map((p) => [p.id, p]));

    return rows.map((r) => {
      const plugin = byId.get(r.pluginId);
      return {
        organizationId: r.organizationId,
        pluginId: r.pluginId,
        pluginCode: plugin?.code,
        pluginName: plugin?.name,
        activationSource: r.activationSource,
        requiredByPluginId: r.requiredByPluginId,
        status: r.status,
        activatedAt: r.activatedAt,
        deactivatedAt: r.deactivatedAt,
      };
    });
  }
}
