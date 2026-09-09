import {
  BusinessProfileRecommendationsDTO,
  RecommendationItemDTO,
  RecommendationPluginDTO,
  RecommendationRequirementDTO,
} from '../dtos';
import {
  BusinessProfileNotFoundError,
} from '../../domain/errors';
import {
  BusinessProfileRepository,
  BusinessProfileTranslation,
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
  PluginTranslation,
  PluginTranslationRepository,
} from '../../domain/repositories';
import { Plugin } from '../../domain/entities';
import { BASE_LOCALE, localizeText } from '../localization';

/**
 * Los plugins recomendados por un perfil, con el estado de la organización que
 * la pantalla de recomendaciones necesita para pintarse sin más llamadas.
 */
export class GetBusinessProfileRecommendationsUseCase {
  constructor(
    private readonly profiles: BusinessProfileRepository,
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly translations: PluginTranslationRepository,
  ) {}

  async execute(
    organizationId: string,
    profileCode: string,
    locale: string = BASE_LOCALE,
  ): Promise<BusinessProfileRecommendationsDTO> {
    const profile = await this.profiles.findByCode(profileCode);
    if (!profile || !profile.isActive) throw new BusinessProfileNotFoundError();

    const profilePlugins = await this.profiles.findPlugins(profile.id);
    const pluginIds = profilePlugins.map((p) => p.pluginId);
    const plugins = (await Promise.all(pluginIds.map((id) => this.plugins.findById(id))))
      .filter((p): p is Plugin => p !== null);

    const byId = new Map(plugins.map((p) => [p.id, p]));
    const orgRows = await this.organizationPlugins.listByOrganization(organizationId);
    const activeIds = new Set(orgRows.filter((r) => r.status === 'active').map((r) => r.pluginId));

    const translations =
      locale === BASE_LOCALE
        ? new Map<string, PluginTranslation>()
        : await this.translations.mapByLocale(locale);

    const prTr = await this.profiles.findTranslation(profile.id, locale);

    const items: RecommendationItemDTO[] = [];
    let total = 0;

    for (const pp of profilePlugins) {
      const plugin = byId.get(pp.pluginId);
      if (!plugin) continue;

      const alreadyActive = activeIds.has(plugin.id);
      const text = localizeText(
        { name: plugin.name, category: plugin.category, description: plugin.description },
        translations.get(plugin.id),
      );

      const pluginDTO: RecommendationPluginDTO = {
        code: plugin.code,
        name: text.name,
        category: text.category,
        buildStatus: plugin.buildStatus,
        priceCents: plugin.priceCents,
        currency: plugin.currency,
      };

      // Dependencias directas del plugin. `alreadyActive` se resuelve al estado
      // final (activa o la trae el lote automáticamente): la UI solo avisa de las
      // que piden decisión o activación previa (state = blocked).
      const direct = await this.dependencies.listDependenciesOf(plugin.id);
      const directPlugins = (await Promise.all(
        direct.map((d) => this.plugins.findById(d.dependsOnPluginId)),
      )).filter((p): p is Plugin => p !== null);
      const autoByPlugin = new Map(direct.map((d) => [d.dependsOnPluginId, d.autoActivate]));

      const requires: RecommendationRequirementDTO[] = directPlugins.map((dp) => {
        const auto = autoByPlugin.get(dp.id) === true && dp.isBuyable;
        return {
          code: dp.code,
          alreadyActive: activeIds.has(dp.id) || dp.isCore || auto,
        };
      });

      let state: RecommendationItemDTO['state'];
      if (alreadyActive) {
        state = 'already_active';
      } else if (plugin.buildStatus !== 'disponible') {
        state = 'coming_soon';
      } else if (requires.some((r) => !r.alreadyActive)) {
        state = 'blocked';
      } else {
        state = 'activatable';
        if (!plugin.isCore) total += plugin.priceCents;
      }

      items.push({ plugin: pluginDTO, recommendation: pp.recommendation, state, alreadyActive, requires });
    }

    const profileName = (prTr as BusinessProfileTranslation | undefined)?.name || profile.name;
    return { profile: { code: profile.code, name: profileName }, items, totalMonthlyCents: total };
  }
}