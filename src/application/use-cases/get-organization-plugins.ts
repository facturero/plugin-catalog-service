import { OrganizationPluginDTO } from '../dtos';
import {
  OrganizationPluginRepository,
  PluginRepository,
  PluginTranslationRepository,
} from '../../domain/repositories';
import { BASE_LOCALE, localizeText } from '../localization';

export class GetOrganizationPluginsUseCase {
  constructor(
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly plugins: PluginRepository,
    private readonly translations: PluginTranslationRepository,
  ) {}

  async execute(organizationId: string, locale: string = BASE_LOCALE): Promise<OrganizationPluginDTO[]> {
    const rows = await this.organizationPlugins.listByOrganization(organizationId);
    const uniqueIds = [...new Set(rows.map((r) => r.pluginId))];
    const found = await Promise.all(uniqueIds.map((id) => this.plugins.findById(id)));
    const byId = new Map(found.filter((p) => p !== null).map((p) => [p.id, p]));
    const texts =
      locale === BASE_LOCALE
        ? new Map()
        : await this.translations.mapByLocale(locale);

    return rows.map((r) => {
      const plugin = byId.get(r.pluginId);
      const name = plugin
        ? localizeText(
            { name: plugin.name, category: plugin.category, description: plugin.description },
            texts.get(plugin.id),
          ).name
        : undefined;
      return {
        organizationId: r.organizationId,
        pluginId: r.pluginId,
        pluginCode: plugin?.code,
        pluginName: name,
        activationSource: r.activationSource,
        requiredByPluginId: r.requiredByPluginId,
        status: r.status,
        activatedAt: r.activatedAt,
        deactivatedAt: r.deactivatedAt,
      };
    });
  }
}
