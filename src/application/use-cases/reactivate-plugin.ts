import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { paidThroughOfDeactivated } from '../../domain/billing-period';
import { OrganizationPlugin, Plugin } from '../../domain/entities';
import {
  CorePluginNotConfigurableError,
  PluginAlreadyActiveError,
  PluginNotFoundError,
  ReactivationNotFreeError,
} from '../../domain/errors';

/**
 * Volver a activar, SIN costo, un módulo que se desactivó antes de que terminara lo que ya estaba pago (o la prueba gratis):
 * el cliente todavía tiene derecho a usarlo y cobrárselo de nuevo sería cobrarle dos veces. Se restaura la misma fila (con su
 * fecha de activación original, de la que cuelga el ciclo de cobro) y lo que se apagó con él (sus dependencias).
 *
 * Si ya terminó lo pagado, esto no aplica (ReactivationNotFreeError): es una compra nueva y pasa por el carrito.
 */
export class ReactivatePluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string, pluginCode: string, now: Date = new Date()): Promise<OrganizationPluginDTO[]> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();
      if (plugin.isCore) throw new CorePluginNotConfigurableError(plugin.code);

      const row = await repos.organizationPlugins.find(organizationId, plugin.id);
      if (!row) throw new PluginNotFoundError();
      if (row.status === 'active') throw new PluginAlreadyActiveError();

      const trial = await repos.organizationTrials.find(organizationId);
      const stillPaid = (op: OrganizationPlugin, p: Plugin): boolean =>
        p.priceCents === 0 ||
        (op.deactivatedAt !== null &&
          paidThroughOfDeactivated({
            activatedAt: op.activatedAt,
            deactivatedAt: op.deactivatedAt,
            trialEndsAt: trial?.endsAt ?? null,
            now,
          }) !== null);
      if (!stillPaid(row, plugin)) throw new ReactivationNotFreeError();

      // Sus dependencias: las que están activas siguen; las que se apagaron con él vuelven si también seguían pagadas.
      const restore: { row: OrganizationPlugin; plugin: Plugin }[] = [{ row, plugin }];
      const transitive = await repos.dependencies.resolveTransitiveDependencies(plugin.id);
      for (const edge of new Set(transitive.map((d) => d.dependsOnPluginId))) {
        const dep = await repos.plugins.findById(edge);
        if (!dep || dep.isCore) continue;
        const depRow = await repos.organizationPlugins.find(organizationId, dep.id);
        if (depRow?.status === 'active') continue;
        if (!depRow || !stillPaid(depRow, dep)) throw new ReactivationNotFreeError();
        restore.push({ row: depRow, plugin: dep });
      }

      for (const item of restore) {
        item.row.reactivate();
        await repos.organizationPlugins.save(item.row);
        await repos.carts.remove(organizationId, item.plugin.id);
        await repos.outbox.add({
          type: 'plugin.activated',
          aggregateType: 'plugin',
          aggregateId: item.row.pluginId,
          payload: {
            organizationId,
            pluginId: item.row.pluginId,
            code: item.plugin.code,
            activationSource: item.row.activationSource,
            requiredByPluginId: item.row.requiredByPluginId,
            reactivated: true,
          },
          occurredAt: now,
        });
      }

      return restore.map(({ row: op, plugin: p }): OrganizationPluginDTO => ({
        organizationId,
        pluginId: op.pluginId,
        pluginCode: p.code,
        pluginName: p.name,
        activationSource: op.activationSource,
        requiredByPluginId: op.requiredByPluginId,
        status: op.status,
        activatedAt: op.activatedAt,
        deactivatedAt: op.deactivatedAt,
        deactivateAt: op.deactivateAt,
      }));
    });
  }
}
