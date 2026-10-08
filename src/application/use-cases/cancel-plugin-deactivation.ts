import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { PluginNotFoundError } from '../../domain/errors';

/**
 * Arrepentirse antes de que llegue la fecha: el módulo sigue activo y se borra la baja programada. No se cobra nada de
 * nuevo (el periodo ya estaba pago) ni se canjea otro descuento. Si no había baja programada, no hace nada.
 */
export class CancelPluginDeactivationUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string, pluginCode: string): Promise<OrganizationPluginDTO> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();
      const row = await repos.organizationPlugins.find(organizationId, plugin.id);
      if (!row || row.status !== 'active') throw new PluginNotFoundError();

      if (row.deactivateAt) {
        row.cancelDeactivation();
        await repos.organizationPlugins.save(row);
        await repos.outbox.add({
          type: 'plugin.deactivation_cancelled',
          aggregateType: 'plugin',
          aggregateId: plugin.id,
          payload: { organizationId, pluginId: plugin.id, code: plugin.code },
          occurredAt: new Date(),
        });
      }

      return {
        organizationId,
        pluginId: plugin.id,
        pluginCode: plugin.code,
        pluginName: plugin.name,
        activationSource: row.activationSource,
        requiredByPluginId: row.requiredByPluginId,
        status: row.status,
        activatedAt: row.activatedAt,
        deactivatedAt: row.deactivatedAt,
        deactivateAt: row.deactivateAt,
      };
    });
  }
}
