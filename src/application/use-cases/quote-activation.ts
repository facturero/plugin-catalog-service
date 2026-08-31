import { PluginDTO, QuoteDTO, QuoteRequirementDTO } from '../dtos';
import { PluginNotFoundError, PluginNotVisibleToOrganizationError } from '../../domain/errors';
import {
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
  PluginTranslation,
  PluginTranslationRepository,
} from '../../domain/repositories';
import { BASE_LOCALE, localizeText } from '../localization';

export class QuoteActivationUseCase {
  constructor(
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly translations: PluginTranslationRepository,
  ) {}

  async execute(organizationId: string, pluginCode: string, locale: string = BASE_LOCALE): Promise<QuoteDTO> {
    const plugin = await this.plugins.findByCode(pluginCode);
    if (!plugin) throw new PluginNotFoundError();
    if (!plugin.isVisibleTo(organizationId)) throw new PluginNotVisibleToOrganizationError();

    const transitive = await this.dependencies.resolveTransitiveDependencies(plugin.id);
    const depIds = [...new Set(transitive.map((d) => d.dependsOnPluginId))];
    const depPlugins = (await Promise.all(depIds.map((id) => this.plugins.findById(id))))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const byId = new Map(depPlugins.map((p) => [p.id, p]));
    const texts =
      locale === BASE_LOCALE
        ? new Map<string, PluginTranslation>()
        : await this.translations.mapByLocale(locale);

    const requires: QuoteRequirementDTO[] = [];
    let total = plugin.priceCents;
    for (const d of transitive) {
      const depPlugin = byId.get(d.dependsOnPluginId);
      if (!depPlugin) continue;
      const row = await this.organizationPlugins.find(organizationId, depPlugin.id);
      const already_active = row?.status === 'active';
      requires.push({
        plugin: toDto(depPlugin, texts.get(depPlugin.id)),
        price: depPlugin.priceCents,
        already_active,
      });
      if (!already_active) total += depPlugin.priceCents;
    }

    return {
      plugin: toDto(plugin, texts.get(plugin.id)),
      price: plugin.priceCents,
      requires,
      total_monthly: total,
    };
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
}, translation?: PluginTranslation): PluginDTO {
  const text = localizeText(
    { name: p.name, category: p.category, description: p.description },
    translation,
  );
  return {
    id: p.id,
    code: p.code,
    name: text.name,
    category: text.category,
    description: text.description,
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
