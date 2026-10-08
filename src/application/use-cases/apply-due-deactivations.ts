import { UnitOfWork } from '../ports';
import { OrganizationPluginRepository, PluginRepository } from '../../domain/repositories';
import { BlockingDependentsError, PluginNotFoundError } from '../../domain/errors';
import { DeactivatePluginUseCase } from './deactivate-plugin';

/**
 * El barrido que cumple las bajas programadas: apaga de verdad los módulos cuya fecha ya llegó (y lo que se activó solo
 * por ellos). Cada uno va en su propia transacción: si uno falla, los demás siguen. Es idempotente, así que correrlo en
 * dos réplicas a la vez a lo sumo repite trabajo ya hecho.
 */
export class ApplyDueDeactivationsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationPlugins: OrganizationPluginRepository,
    private readonly plugins: PluginRepository,
    private readonly deactivate: DeactivatePluginUseCase,
  ) {}

  /** Devuelve cuántos módulos se apagaron. */
  async execute(now: Date = new Date()): Promise<number> {
    const due = await this.organizationPlugins.listDueForDeactivation(now);
    let applied = 0;
    for (const row of due) {
      const plugin = await this.plugins.findById(row.pluginId);
      if (!plugin) continue;
      try {
        const done = await this.deactivate.applyNow(row.organizationId, plugin.code);
        applied += done.length;
      } catch (e) {
        if (e instanceof PluginNotFoundError) continue; // ya se apagó (por cascada o a mano) mientras tanto
        if (e instanceof BlockingDependentsError) {
          // Desde que se programó, la organización activó algo que lo necesita: la baja ya no es posible.
          await this.cancelBecauseOfDependents(row.organizationId, plugin.id, plugin.code, e.blocking);
          continue;
        }
        console.error(`[plugin-catalog-service] No se pudo apagar ${plugin.code} de ${row.organizationId}:`, e);
      }
    }
    return applied;
  }

  private async cancelBecauseOfDependents(organizationId: string, pluginId: string, code: string, blockedBy: unknown): Promise<void> {
    await this.uow.execute(async (repos) => {
      const row = await repos.organizationPlugins.find(organizationId, pluginId);
      if (!row || !row.deactivateAt) return;
      row.cancelDeactivation();
      await repos.organizationPlugins.save(row);
      await repos.outbox.add({
        type: 'plugin.deactivation_cancelled',
        aggregateType: 'plugin',
        aggregateId: pluginId,
        payload: { organizationId, pluginId, code, reason: 'dependents', blockedBy },
        occurredAt: new Date(),
      });
    });
  }
}
