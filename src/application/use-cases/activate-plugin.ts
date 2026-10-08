import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { AppliedDiscount, redemptionExpiry, resolveDiscount } from '../discount-pricing';
import { ActivationPlan, planActivation } from '../activation-plan';
import { OrganizationPlugin, Plugin } from '../../domain/entities';
import {
  CorePluginNotConfigurableError,
  MissingDependenciesError,
  PluginAlreadyActiveError,
  PluginNotAvailableError,
  PluginNotFoundError,
  PluginNotVisibleToOrganizationError,
  ValidationError,
} from '../../domain/errors';

export class ActivatePluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  /** Activa UN módulo (y lo que necesita). Es el carrito con un solo artículo. */
  async execute(
    organizationId: string,
    pluginCode: string,
    options: { discountCode?: string; userId?: string | null } = {},
  ): Promise<OrganizationPluginDTO[]> {
    return this.executeMany(organizationId, [pluginCode], options);
  }

  /**
   * Activa VARIOS módulos a la vez (el carrito), todo o nada: si uno no se puede activar, ninguno se activa ni se cobra.
   * Lo que comparten se activa una sola vez. `options.discountCode`: un código para todo el carrito; se valida ANTES de
   * activar nada y se canjea UNA vez, en la misma transacción. `options.userId` queda en el canje para saber quién lo usó.
   */
  async executeMany(
    organizationId: string,
    pluginCodes: string[],
    options: { discountCode?: string; userId?: string | null } = {},
  ): Promise<OrganizationPluginDTO[]> {
    if (pluginCodes.length === 0) throw new ValidationError([{ field: 'codes', message: 'Elige al menos un módulo.' }]);

    return this.uow.execute(async (repos) => {
      const plan = await planActivation(repos, organizationId, pluginCodes);
      this.assertActivatable(plan);

      const deps = plan.dependencies.filter((d) => !d.alreadyActive);
      const payLines = [
        ...plan.selected.map((p) => ({ pluginCode: p.code, priceCents: p.priceCents })),
        ...deps.map((d) => ({ pluginCode: d.plugin.code, priceCents: d.plugin.priceCents })),
      ];
      let applied: AppliedDiscount | null = null;
      if (options.discountCode?.trim()) {
        applied = await resolveDiscount({
          discounts: repos.discounts,
          redemptions: repos.discountRedemptions,
          organizationId,
          code: options.discountCode,
          lines: payLines,
          lock: true,
        });
      }

      const activated: { row: OrganizationPlugin; plugin: Plugin }[] = [];
      for (const d of deps) {
        const row = OrganizationPlugin.activateAsDependency(organizationId, d.plugin.id, d.requiredBy.id);
        await repos.organizationPlugins.save(row);
        activated.push({ row, plugin: d.plugin });
      }
      for (const plugin of plan.selected) {
        const row = OrganizationPlugin.activateDirect(organizationId, plugin.id);
        await repos.organizationPlugins.save(row);
        activated.push({ row, plugin });
      }

      for (const { row, plugin } of activated) {
        await repos.outbox.add({
          type: 'plugin.activated',
          aggregateType: 'plugin',
          aggregateId: row.pluginId,
          payload: {
            organizationId,
            pluginId: row.pluginId,
            code: plugin.code,
            activationSource: row.activationSource,
            requiredByPluginId: row.requiredByPluginId,
          },
          occurredAt: new Date(),
        });
      }

      // Lo que se acaba de activar ya no está pendiente: sale del carrito guardado de la organización.
      for (const plugin of [...plan.selected, ...plan.alreadyActive]) {
        await repos.carts.remove(organizationId, plugin.id);
      }

      if (applied) {
        const now = new Date();
        const { discount, result } = applied;
        // Si la prueba sigue activa, el descuento (y su duración) cuentan desde que termina: la prueba no lo gasta.
        const trial = await repos.organizationTrials.find(organizationId);
        const startsAt = trial && trial.isActiveAt(now) ? trial.endsAt : now;
        const chosen = plan.selected.map((p) => p.code);
        const listCents = payLines.reduce((sum, l) => sum + l.priceCents, 0);
        await repos.discountRedemptions.add({
          id: randomUUID(),
          discountId: discount.id,
          organizationId,
          pluginCode: chosen.join(','),
          redeemedByUserId: options.userId ?? null,
          listCents,
          discountCents: result.discountCents,
          finalCents: result.totalCents,
          redeemedAt: now,
          expiresAt: redemptionExpiry(discount, startsAt),
        });
        discount.registerRedemption();
        await repos.discounts.save(discount);
        // `pricing.` y no `plugin.`: el gateway recarga los módulos de la organización con cada `plugin.*`.
        await repos.outbox.add({
          type: 'pricing.discount.redeemed',
          aggregateType: 'discount',
          aggregateId: discount.id,
          payload: {
            targetId: discount.id,
            organizationId,
            discountCode: discount.code,
            pluginCode: chosen.join(','),
            pluginCodes: chosen,
            listCents,
            discountCents: result.discountCents,
            finalCents: result.totalCents,
            durationMonths: discount.durationMonths,
            startsAt,
          },
          occurredAt: now,
        });
      }

      return activated.map(({ row, plugin }): OrganizationPluginDTO => ({
        organizationId: row.organizationId,
        pluginId: row.pluginId,
        pluginCode: plugin.code,
        pluginName: plugin.name,
        activationSource: row.activationSource,
        requiredByPluginId: row.requiredByPluginId,
        status: row.status,
        activatedAt: row.activatedAt,
        deactivatedAt: row.deactivatedAt,
      }));
    });
  }

  /** Convierte lo que el plan no permite en el mismo error que daba activar de a uno. */
  private assertActivatable(plan: ActivationPlan): void {
    const bad = plan.invalid[0];
    if (bad) {
      if (bad.reason === 'core') throw new CorePluginNotConfigurableError(bad.code);
      if (bad.reason === 'not_available') throw new PluginNotAvailableError(bad.buildStatus ?? 'en_construccion');
      if (bad.reason === 'not_visible') throw new PluginNotVisibleToOrganizationError();
      throw new PluginNotFoundError();
    }
    if (plan.selected.length === 0) {
      if (plan.alreadyActive.length > 0) throw new PluginAlreadyActiveError();
      throw new ValidationError([{ field: 'codes', message: 'No hay nada que activar.' }]);
    }
    if (plan.missing.length > 0) throw new MissingDependenciesError(plan.missing);
  }
}
