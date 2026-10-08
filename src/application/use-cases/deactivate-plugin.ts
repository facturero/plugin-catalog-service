import { UnitOfWork } from '../ports';
import { OrganizationPluginDTO } from '../dtos';
import { currentPeriodEnd } from '../../domain/billing-period';
import { OrganizationPlugin, Plugin } from '../../domain/entities';
import { Repositories } from '../../domain/repositories';
import {
  BlockingDependentsError,
  CorePluginNotConfigurableError,
  PluginNotFoundError,
} from '../../domain/errors';

export class DeactivatePluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Pedir la baja de un módulo es «suave»: lo ya pagado se respeta. El módulo sigue activo y funcionando hasta que termina
   * el periodo mensual que la organización ya tiene pago (durante la prueba gratis, hasta que ella termina); recién
   * entonces lo apaga de verdad el barrido (`ApplyDueDeactivationsUseCase`) y desaparece de «Mis módulos».
   * Un módulo gratis no tiene nada pago que esperar: se apaga en el acto. Repetir la petición no cambia la fecha.
   */
  async execute(organizationId: string, pluginCode: string, now: Date = new Date()): Promise<OrganizationPluginDTO[]> {
    return this.uow.execute(async (repos) => {
      const { plugin, target, orgRows } = await this.prepare(repos, organizationId, pluginCode);
      if (target.deactivateAt) return [toDto(target, plugin)];

      if (plugin.priceCents === 0) return this.deactivateNow(repos, organizationId, plugin, target, orgRows);

      const trial = await repos.organizationTrials.find(organizationId);
      const at = currentPeriodEnd({ activatedAt: target.activatedAt, trialEndsAt: trial?.endsAt ?? null, now });
      target.scheduleDeactivation(at);
      await repos.organizationPlugins.save(target);
      await repos.outbox.add({
        type: 'plugin.deactivation_scheduled',
        aggregateType: 'plugin',
        aggregateId: plugin.id,
        payload: { organizationId, pluginId: plugin.id, code: plugin.code, deactivateAt: at },
        occurredAt: now,
      });
      return [toDto(target, plugin)];
    });
  }

  /** Apaga el módulo YA (y lo que se activó solo por él). Lo usa el barrido cuando llega la fecha, y los módulos gratis. */
  async applyNow(organizationId: string, pluginCode: string): Promise<OrganizationPluginDTO[]> {
    return this.uow.execute(async (repos) => {
      const { plugin, target, orgRows } = await this.prepare(repos, organizationId, pluginCode);
      return this.deactivateNow(repos, organizationId, plugin, target, orgRows);
    });
  }

  private async prepare(repos: Repositories, organizationId: string, pluginCode: string) {
    const plugin = await repos.plugins.findByCode(pluginCode);
    if (!plugin) throw new PluginNotFoundError();
    if (plugin.isCore) throw new CorePluginNotConfigurableError(plugin.code);

    const target = await repos.organizationPlugins.find(organizationId, plugin.id);
    if (!target || target.status !== 'active') throw new PluginNotFoundError();

    const orgRows = await repos.organizationPlugins.listByOrganization(organizationId);
    const activeByPlugin = new Map(
      orgRows.filter((r) => r.status === 'active').map((r) => [r.pluginId, r]),
    );

    // Bloqueo inmediato: dependientes DIRECTOS activos de esta organización.
    const directDependents = await repos.dependencies.listDependentsOf(plugin.id);
    const blockingIds = directDependents
      .filter((d) => activeByPlugin.has(d.pluginId))
      .map((d) => d.pluginId);
    if (blockingIds.length > 0) {
      const found = await Promise.all(blockingIds.map((id) => repos.plugins.findById(id)));
      throw new BlockingDependentsError(found.filter((p) => p !== null).map((p) => p.code));
    }
    return { plugin, target, orgRows };
  }

  private async deactivateNow(
    repos: Repositories,
    organizationId: string,
    plugin: Plugin,
    target: OrganizationPlugin,
    orgRows: OrganizationPlugin[],
  ): Promise<OrganizationPluginDTO[]> {
    const activeByPlugin = new Map(
      orgRows.filter((r) => r.status === 'active').map((r) => [r.pluginId, r]),
    );

    // Una baja programada que se cumple vale desde su fecha programada (no desde que el barrido la aplicó), también para lo
    // que se apaga con ella.
    const effectiveAt = target.deactivateAt ?? new Date();

    // Fase 1 — planificar el conjunto a desactivar (fixpoint sobre cadenas A→B→C):
    // un candidato se apaga solo si NINGÚN otro plugin activo (fuera del plan) lo necesita.
    // Se itera hasta estabilizar: apagar C puede liberar a B en una pasada posterior.
    const planned = new Set<string>([target.pluginId]);
    let changed = true;
    while (changed) {
      changed = false;
      const candidates = orgRows.filter(
        (r) =>
          r.activationSource === 'dependency' &&
          r.status === 'active' &&
          !planned.has(r.pluginId) &&
          r.requiredByPluginId !== null &&
          planned.has(r.requiredByPluginId),
      );
      for (const candidate of candidates) {
        if (planned.has(candidate.pluginId)) continue;
        const needed = await this.isStillNeeded(
          repos,
          activeByPlugin,
          candidate.pluginId,
          planned,
        );
        if (!needed) {
          planned.add(candidate.pluginId);
          changed = true;
        }
      }
    }

    // Fase 2 — aplicar y emitir eventos.
    const deactivated = [];
    const codeById = new Map<string, string>();
    for (const pluginId of planned) {
      const row = await repos.organizationPlugins.find(organizationId, pluginId);
      if (!row || row.status !== 'active') continue;
      row.deactivate(effectiveAt);
      await repos.organizationPlugins.save(row);
      deactivated.push(row);
      const p = pluginId === plugin.id ? plugin : await repos.plugins.findById(pluginId);
      if (p) codeById.set(pluginId, p.code);
    }

    for (const op of deactivated) {
      await repos.outbox.add({
        type: 'plugin.deactivated',
        aggregateType: 'plugin',
        aggregateId: op.pluginId,
        payload: {
          organizationId,
          pluginId: op.pluginId,
          code: codeById.get(op.pluginId),
        },
        occurredAt: new Date(),
      });
    }

    return deactivated.map((op): OrganizationPluginDTO => ({
      organizationId: op.organizationId,
      pluginId: op.pluginId,
      pluginCode: codeById.get(op.pluginId),
      activationSource: op.activationSource,
      requiredByPluginId: op.requiredByPluginId,
      status: op.status,
      activatedAt: op.activatedAt,
      deactivatedAt: op.deactivatedAt,
      deactivateAt: op.deactivateAt,
    }));
  }

  /** ¿Algún otro plugin ACTIVO de la org necesita `pluginId`, excluyendo lo ya planificado a desactivar? */
  private async isStillNeeded(
    repos: {
      dependencies: { listDependentsOf(pluginId: string): Promise<{ pluginId: string }[]> };
    },
    activeByPlugin: Map<string, unknown>,
    pluginId: string,
    planned: Set<string>,
  ): Promise<boolean> {
    const dependents = await repos.dependencies.listDependentsOf(pluginId);
    return dependents.some(
      (d) => activeByPlugin.has(d.pluginId) && !planned.has(d.pluginId),
    );
  }
}

function toDto(op: OrganizationPlugin, plugin: Plugin): OrganizationPluginDTO {
  return {
    organizationId: op.organizationId,
    pluginId: op.pluginId,
    pluginCode: plugin.code,
    pluginName: plugin.name,
    activationSource: op.activationSource,
    requiredByPluginId: op.requiredByPluginId,
    status: op.status,
    activatedAt: op.activatedAt,
    deactivatedAt: op.deactivatedAt,
    deactivateAt: op.deactivateAt,
  };
}
