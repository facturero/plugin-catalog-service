import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { AppliedDiscount, redemptionExpiry, resolveDiscount } from '../discount-pricing';
import { OrganizationPlugin } from '../../domain/entities';
import {
  CorePluginNotConfigurableError,
  MissingDependenciesError,
  PluginAlreadyActiveError,
  PluginNotAvailableError,
  PluginNotFoundError,
  PluginNotVisibleToOrganizationError,
} from '../../domain/errors';

export class ActivatePluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * `options.discountCode`: un código de descuento para lo que se activa ahora (el módulo y las dependencias que aún no
   * estaban). Se valida ANTES de activar nada y se canjea en la misma transacción: si el código no vale, no se activa
   * ni se cobra nada a medias. `options.userId` queda en el canje para saber quién lo usó.
   */
  async execute(
    organizationId: string,
    pluginCode: string,
    options: { discountCode?: string; userId?: string | null } = {},
  ): Promise<OrganizationPluginDTO[]> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();
      if (!plugin.isVisibleTo(organizationId)) throw new PluginNotVisibleToOrganizationError();
      if (plugin.isCore) throw new CorePluginNotConfigurableError(plugin.code);
      if (!plugin.isBuyable) throw new PluginNotAvailableError(plugin.buildStatus);

      const existing = await repos.organizationPlugins.find(organizationId, plugin.id);
      if (existing?.status === 'active') throw new PluginAlreadyActiveError();

      const transitive = await repos.dependencies.resolveTransitiveDependencies(plugin.id);
      const depIds = [...new Set(transitive.map((d) => d.dependsOnPluginId))];
      const depPlugins = (
        await Promise.all(depIds.map((id) => repos.plugins.findById(id)))
      ).filter((p): p is NonNullable<typeof p> => p !== null);
      const byId = new Map(depPlugins.map((p) => [p.id, p]));

      const missing: string[] = [];
      const toActivate: { pluginId: string; autoActivate: boolean }[] = [];
      for (const d of transitive) {
        const dep = byId.get(d.dependsOnPluginId);
        if (!dep) continue;
        const row = await repos.organizationPlugins.find(organizationId, dep.id);
        if (row?.status === 'active') continue;
        if (!d.autoActivate || !dep.isBuyable) {
          missing.push(dep.code);
          continue;
        }
        toActivate.push({ pluginId: dep.id, autoActivate: true });
      }
      if (missing.length > 0) throw new MissingDependenciesError([...new Set(missing)]);

      const payLines = [
        { pluginCode: plugin.code, priceCents: plugin.priceCents },
        ...toActivate.map((t) => {
          const dep = byId.get(t.pluginId)!;
          return { pluginCode: dep.code, priceCents: dep.priceCents };
        }),
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

      const activated: OrganizationPlugin[] = [];
      for (const t of toActivate) {
        const op = OrganizationPlugin.activateAsDependency(organizationId, t.pluginId, plugin.id);
        await repos.organizationPlugins.save(op);
        activated.push(op);
      }

      const direct = OrganizationPlugin.activateDirect(organizationId, plugin.id);
      await repos.organizationPlugins.save(direct);
      activated.push(direct);

      for (const op of activated) {
        const p = op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!;
        await repos.outbox.add({
          type: 'plugin.activated',
          aggregateType: 'plugin',
          aggregateId: op.pluginId,
          payload: {
            organizationId,
            pluginId: op.pluginId,
            code: p.code,
            activationSource: op.activationSource,
            requiredByPluginId: op.requiredByPluginId,
          },
          occurredAt: new Date(),
        });
      }

      if (applied) {
        const now = new Date();
        const { discount, result } = applied;
        // Si la prueba sigue activa, el descuento (y su duración) cuentan desde que termina: la prueba no lo gasta.
        const trial = await repos.organizationTrials.find(organizationId);
        const startsAt = trial && trial.isActiveAt(now) ? trial.endsAt : now;
        await repos.discountRedemptions.add({
          id: randomUUID(),
          discountId: discount.id,
          organizationId,
          pluginCode: plugin.code,
          redeemedByUserId: options.userId ?? null,
          listCents: payLines.reduce((sum, l) => sum + l.priceCents, 0),
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
            pluginCode: plugin.code,
            listCents: payLines.reduce((sum, l) => sum + l.priceCents, 0),
            discountCents: result.discountCents,
            finalCents: result.totalCents,
            durationMonths: discount.durationMonths,
            startsAt,
          },
          occurredAt: now,
        });
      }

      return activated.map((op): OrganizationPluginDTO => ({
        organizationId: op.organizationId,
        pluginId: op.pluginId,
        pluginCode: (op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!).code,
        pluginName: (op.pluginId === plugin.id ? plugin : byId.get(op.pluginId)!).name,
        activationSource: op.activationSource,
        requiredByPluginId: op.requiredByPluginId,
        status: op.status,
        activatedAt: op.activatedAt,
        deactivatedAt: op.deactivatedAt,
      }));
    });
  }
}
