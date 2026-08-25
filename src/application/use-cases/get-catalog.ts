import { PluginDTO, CatalogPluginDTO, DisplayStatus } from '../dtos';
import {
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
} from '../../domain/repositories';

export class GetCatalogUseCase {
  constructor(
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
  ) {}

  async execute(organizationId: string | null): Promise<CatalogPluginDTO[]> {
    const visible = await this.plugins.listVisibleTo(organizationId);
    const rows = organizationId === null ? [] : await this.organizationPlugins.listByOrganization(organizationId);
    const edges = await this.dependencies.listAll();

    const rowByPlugin = new Map(rows.map((r) => [r.pluginId, r]));
    const byId = new Map(visible.map((p) => [p.id, p]));

    const depsByPlugin = new Map<string, { code: string; name: string; autoActivate: boolean }[]>();
    for (const e of edges) {
      const target = byId.get(e.dependsOnPluginId);
      if (!target) continue;
      if (!depsByPlugin.has(e.pluginId)) depsByPlugin.set(e.pluginId, []);
      depsByPlugin.get(e.pluginId)!.push({
        code: target.code,
        name: target.name,
        autoActivate: e.autoActivate,
      });
    }

    return visible.map((p): CatalogPluginDTO => {
      const base: PluginDTO = {
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        description: p.description,
        imageUrl: p.imageUrl,
        buildStatus: p.buildStatus,
        priceCents: p.priceCents,
        currency: p.currency,
        isActive: p.isActive,
        isPublic: p.isPublic,
        createdForOrganizationId: p.createdForOrganizationId,
        basedOnPluginId: p.basedOnPluginId,
      };
      let display_status: DisplayStatus;
      if (p.buildStatus !== 'disponible') {
        display_status = 'en_construccion';
      } else {
        const row = rowByPlugin.get(p.id);
        display_status = !row ? 'disponible' : row.status === 'active' ? 'comprado' : 'desactivado';
      }
      return {
        ...base,
        display_status,
        is_exclusive: organizationId !== null && p.createdForOrganizationId === organizationId,
        depends_on: depsByPlugin.get(p.id) ?? [],
      };
    });
  }
}
