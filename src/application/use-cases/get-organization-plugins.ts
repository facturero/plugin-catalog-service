import { OrganizationPluginDTO } from '../dtos';
import {
  OrganizationPluginRepository,
  OrganizationTrialRepository,
  PluginRepository,
  PluginTranslationRepository,
} from '../../domain/repositories';
import { currentPeriodEnd, paidThroughOfDeactivated } from '../../domain/billing-period';
import { BASE_LOCALE, localizeText } from '../localization';

export class GetOrganizationPluginsUseCase {
  constructor(
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly plugins: PluginRepository,
    private readonly translations: PluginTranslationRepository,
    private readonly trials: OrganizationTrialRepository,
  ) {}

  async execute(
    organizationId: string,
    locale: string = BASE_LOCALE,
    now: Date = new Date(),
  ): Promise<OrganizationPluginDTO[]> {
    const stored = await this.organizationPlugins.listByOrganization(organizationId);
    const trial = await this.trials.find(organizationId);

    // Lo incluido en la plataforma (el núcleo y los módulos base gratuitos) está activo para TODA organización sin que
    // haya una fila que lo diga: se informa aquí, como activo, para que el gateway deje pasar sus rutas y el frontend
    // sepa que está disponible. No se puede comprar ni apagar; la pantalla de «Mis módulos» no lo lista.
    const core = (await this.plugins.listAll()).filter((p) => p.isCore);
    const coreIds = new Set(core.map((p) => p.id));
    const rows = stored.filter((r) => !coreIds.has(r.pluginId));

    const uniqueIds = [...new Set(rows.map((r) => r.pluginId))];
    const found = await Promise.all(uniqueIds.map((id) => this.plugins.findById(id)));
    const byId = new Map(found.filter((p) => p !== null).map((p) => [p.id, p]));
    const texts =
      locale === BASE_LOCALE
        ? new Map()
        : await this.translations.mapByLocale(locale);

    const nameOf = (plugin: { id: string; name: string; category: string; description: string } | undefined) =>
      plugin
        ? localizeText(
            { name: plugin.name, category: plugin.category, description: plugin.description },
            texts.get(plugin.id),
          ).name
        : undefined;

    const included: OrganizationPluginDTO[] = core.map((plugin) => ({
      organizationId,
      pluginId: plugin.id,
      pluginCode: plugin.code,
      pluginName: nameOf(plugin),
      activationSource: 'included',
      requiredByPluginId: null,
      status: 'active',
      activatedAt: plugin.createdAt,
      deactivatedAt: null,
      deactivateAt: null,
      periodEndsAt: null,
    }));

    const own = rows.map((r): OrganizationPluginDTO => {
      const plugin = byId.get(r.pluginId);
      return {
        organizationId: r.organizationId,
        pluginId: r.pluginId,
        pluginCode: plugin?.code,
        pluginName: nameOf(plugin),
        activationSource: r.activationSource,
        requiredByPluginId: r.requiredByPluginId,
        status: r.status,
        activatedAt: r.activatedAt,
        deactivatedAt: r.deactivatedAt,
        deactivateAt: r.deactivateAt,
        reactivableUntil:
          r.status === 'disabled' && r.deactivatedAt && plugin && plugin.priceCents > 0
            ? paidThroughOfDeactivated({
                activatedAt: r.activatedAt,
                deactivatedAt: r.deactivatedAt,
                trialEndsAt: trial?.endsAt ?? null,
                now,
              })
            : null,
        // La fecha en que terminaría el periodo pago: es cuando se haría efectiva una baja. Un módulo gratis no tiene.
        periodEndsAt:
          r.status === 'active' && plugin && plugin.priceCents > 0
            ? currentPeriodEnd({ activatedAt: r.activatedAt, trialEndsAt: trial?.endsAt ?? null, now })
            : null,
      };
    });

    return [...included, ...own];
  }
}
