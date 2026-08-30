import { PluginDTO, QuoteDTO, QuoteRequirementDTO } from '../dtos';
import { PluginNotFoundError, PluginNotVisibleToOrganizationError } from '../../domain/errors';
import {
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
} from '../../domain/repositories';

export class QuoteActivationUseCase {
  constructor(
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
  ) {}

  async execute(organizationId: string, pluginCode: string): Promise<QuoteDTO> {
    const plugin = await this.plugins.findByCode(pluginCode);
    if (!plugin) throw new PluginNotFoundError();
    if (!plugin.isVisibleTo(organizationId)) throw new PluginNotVisibleToOrganizationError();

    const transitive = await this.dependencies.resolveTransitiveDependencies(plugin.id);
    const depIds = [...new Set(transitive.map((d) => d.dependsOnPluginId))];
    const depPlugins = (await Promise.all(depIds.map((id) => this.plugins.findById(id))))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const byId = new Map(depPlugins.map((p) => [p.id, p]));

    const requires: QuoteRequirementDTO[] = [];
    let total = plugin.priceCents;
    for (const d of transitive) {
      const depPlugin = byId.get(d.dependsOnPluginId);
      if (!depPlugin) continue;
      const row = await this.organizationPlugins.find(organizationId, depPlugin.id);
      const already_active = row?.status === 'active';
      requires.push({ plugin: toDto(depPlugin), price: depPlugin.priceCents, already_active });
      if (!already_active) total += depPlugin.priceCents;
    }

    return { plugin: toDto(plugin), price: plugin.priceCents, requires, total_monthly: total };
  }
}

export function toDto(p: {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string | null;
  buildStatus: 'disponible' | 'en_construccion' | 'descontinuado';
  priceCents: number;
  currency: string;
  isActive: boolean;
  isCore: boolean;
  isPublic: boolean;
  createdForOrganizationId: string | null;
  basedOnPluginId: string | null;
}): PluginDTO {
  return {
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
    isCore: p.isCore,
    isPublic: p.isPublic,
    createdForOrganizationId: p.createdForOrganizationId,
    basedOnPluginId: p.basedOnPluginId,
  };
}
