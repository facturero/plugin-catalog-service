import { PluginDTO, CatalogPluginDTO, DisplayStatus } from '../dtos';
import {
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
  PluginTranslationRepository,
} from '../../domain/repositories';
import { BASE_LOCALE, localizeText } from '../localization';

export class GetCatalogUseCase {
  constructor(
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly translations: PluginTranslationRepository,
  ) {}

  async execute(organizationId: string | null, locale: string = BASE_LOCALE): Promise<CatalogPluginDTO[]> {
    const visible = await this.plugins.listVisibleTo(organizationId);
    const rows = organizationId === null ? [] : await this.organizationPlugins.listByOrganization(organizationId);
    const edges = await this.dependencies.listAll();
    // El idioma base ya está en la propia fila del plugin: no hace falta consulta.
    const texts =
      locale === BASE_LOCALE
        ? new Map()
        : await this.translations.mapByLocale(locale);

    const rowByPlugin = new Map(rows.map((r) => [r.pluginId, r]));
    const byId = new Map(visible.map((p) => [p.id, p]));

    const depsByPlugin = new Map<string, { code: string; name: string; autoActivate: boolean }[]>();
    for (const e of edges) {
      const target = byId.get(e.dependsOnPluginId);
      if (!target) continue;
      if (!depsByPlugin.has(e.pluginId)) depsByPlugin.set(e.pluginId, []);
      depsByPlugin.get(e.pluginId)!.push({
        // El nombre del requisito también se traduce: se muestra al usuario
        // en la tarjeta del catálogo.
        code: target.code,
        name: localizeText(
          { name: target.name, category: target.category, description: target.description },
          texts.get(target.id),
        ).name,
        autoActivate: e.autoActivate,
      });
    }

    return visible.map((p): CatalogPluginDTO => {
      const text = localizeText(
        { name: p.name, category: p.category, description: p.description },
        texts.get(p.id),
      );
      const base: PluginDTO = {
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
      let display_status: DisplayStatus;
      if (p.isCore) {
        display_status = 'incluido';
      } else if (p.buildStatus !== 'disponible') {
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
