import { CartQuoteDTO, CartQuoteItemDTO, PluginDTO, QuoteDTO, QuoteRequirementDTO, QuoteTotals } from '../dtos';
import { planActivation } from '../activation-plan';
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

    // Se descuenta lo que se va a pagar: el módulo y las dependencias que aún no están activas.
    const lines = [
      { pluginCode: plugin.code, priceCents: plugin.priceCents },
      ...requires
        .filter((r) => !r.already_active)
        .map((r) => ({ pluginCode: r.plugin.code, priceCents: r.price })),
    ];
    await this.applyTotals(quote, organizationId, lines, discountCode);
    return quote;
  }

  /**
   * Cotiza VARIOS módulos a la vez (el carrito): lo que comparten se cuenta una sola vez, un código de descuento aplica a
   * todo el carrito y los pedidos que no se pueden activar salen aparte, sin tumbar el resto.
   */
  async executeCart(
    organizationId: string,
    pluginCodes: string[],
    locale: string = BASE_LOCALE,
    discountCode?: string,
  ): Promise<CartQuoteDTO> {
    const plan = await planActivation(
      { plugins: this.plugins, dependencies: this.dependencies, organizationPlugins: this.organizationPlugins },
      organizationId,
      pluginCodes,
    );
    const texts =
      locale === BASE_LOCALE
        ? new Map<string, PluginTranslation>()
        : await this.translations.mapByLocale(locale);

    const items: CartQuoteItemDTO[] = [
      ...plan.selected.map((p): CartQuoteItemDTO => ({ plugin: toDto(p, texts.get(p.id)), price: p.priceCents, kind: 'selected' })),
      ...plan.dependencies.map((d): CartQuoteItemDTO => ({
        plugin: toDto(d.plugin, texts.get(d.plugin.id)),
        price: d.plugin.priceCents,
        kind: d.alreadyActive ? 'already_active' : 'required',
        required_by: d.requiredBy.code,
      })),
      ...plan.alreadyActive.map((p): CartQuoteItemDTO => ({ plugin: toDto(p, texts.get(p.id)), price: p.priceCents, kind: 'already_active' })),
    ];
    const lines = items
      .filter((i) => i.kind !== 'already_active')
      .map((i) => ({ pluginCode: i.plugin.code, priceCents: i.price }));

    const quote: CartQuoteDTO = {
      items,
      // Lo que es privado de otra organización se informa igual que lo que no existe: no se revela que existe.
      invalid: plan.invalid.map(({ code, reason }) => ({ code, reason: reason === 'not_visible' ? 'not_found' : reason })),
      missing: plan.missing,
      total_monthly: lines.reduce((sum, l) => sum + l.priceCents, 0),
    };
    await this.applyTotals(quote, organizationId, lines, discountCode);
    return quote;
  }

  /** Descuento, IVA y prueba gratis sobre un total: igual para un módulo suelto que para el carrito. */
  private async applyTotals(
    quote: QuoteTotals,
    organizationId: string,
    lines: { pluginCode: string; priceCents: number }[],
    discountCode?: string,
  ): Promise<void> {
    if (discountCode?.trim() && this.discounts && this.redemptions && lines.length > 0) {
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
