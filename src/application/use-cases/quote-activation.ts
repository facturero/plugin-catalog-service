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
import { DiscountRedemptionRepository, DiscountRepository, OrganizationTrialRepository } from '../../domain/repositories';
import { PricingPolicy, vatCents } from '../pricing-policy';
import { AppError } from '../../domain/errors';
import { resolveDiscount } from '../discount-pricing';

export class QuoteActivationUseCase {
  constructor(
    private readonly plugins: PluginRepository,
    private readonly dependencies: PluginDependencyRepository,
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly translations: PluginTranslationRepository,
    private readonly discounts?: DiscountRepository,
    private readonly redemptions?: DiscountRedemptionRepository,
    private readonly trials?: OrganizationTrialRepository,
    private readonly policy?: PricingPolicy,
  ) {}

  async execute(
    organizationId: string,
    pluginCode: string,
    locale: string = BASE_LOCALE,
    discountCode?: string,
  ): Promise<QuoteDTO> {
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

    const quote: QuoteDTO = {
      plugin: toDto(plugin, texts.get(plugin.id)),
      price: plugin.priceCents,
      requires,
      total_monthly: total,
    };

    if (discountCode?.trim() && this.discounts && this.redemptions) {
      // Se descuenta lo que se va a pagar: el módulo y las dependencias que aún no están activas.
      const lines = [
        { pluginCode: plugin.code, priceCents: plugin.priceCents },
        ...requires
          .filter((r) => !r.already_active)
          .map((r) => ({ pluginCode: r.plugin.code, priceCents: r.price })),
      ];
      try {
        const { discount, result } = await resolveDiscount({
          discounts: this.discounts,
          redemptions: this.redemptions,
          organizationId,
          code: discountCode,
          lines,
        });
        quote.discount = {
          code: discount.code,
          name: discount.name,
          kind: discount.kind,
          value: discount.value,
          discount_cents: result.discountCents,
          duration_months: discount.durationMonths,
          lines: result.lines.map((l) => ({
            plugin_code: l.pluginCode,
            price: l.priceCents,
            discount: l.discountCents,
            final: l.finalCents,
          })),
        };
        quote.total_after_discount = result.totalCents;
      } catch (err) {
        // Un código malo no tumba la cotización: se explica y se sigue mostrando el precio de lista.
        if (!(err instanceof AppError)) throw err;
        quote.discount_error = { code: err.code, message: err.message };
      }
    }

    if (this.policy) {
      const monthly = quote.total_after_discount ?? quote.total_monthly;
      const vat = vatCents(monthly, this.policy.vatBps);
      quote.vat_percent = this.policy.vatBps / 100;
      quote.vat_cents = vat;
      quote.total_with_vat = monthly + vat;

      const trial = this.trials ? await this.trials.find(organizationId) : null;
      const now = new Date();
      if (trial) {
        quote.trial = { active: trial.isActiveAt(now), ends_at: trial.endsAt.toISOString(), days_left: trial.daysLeftAt(now) };
      }
      // Durante la prueba no se paga nada; el precio de arriba es lo que pagará cuando termine.
      quote.due_today = trial?.isActiveAt(now) ? 0 : quote.total_with_vat;
    }

    return quote;
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
