import { Plugin } from '../domain/entities';
import {
  OrganizationPluginRepository,
  PluginDependencyRepository,
  PluginRepository,
} from '../domain/repositories';

export interface PlanRepositories {
  plugins: PluginRepository;
  dependencies: PluginDependencyRepository;
  organizationPlugins: OrganizationPluginRepository;
}

/** Por qué un módulo pedido no se puede activar. */
export type InvalidReason = 'not_found' | 'not_visible' | 'core' | 'not_available';

export interface PlannedDependency {
  plugin: Plugin;
  /** El primer módulo pedido que lo necesita (el que figurará como su origen). */
  requiredBy: Plugin;
  alreadyActive: boolean;
}

export interface ActivationPlan {
  /** Los pedidos que hay que activar ahora (sin repetidos ni los que ya estaban activos). */
  selected: Plugin[];
  alreadyActive: Plugin[];
  invalid: { code: string; reason: InvalidReason; buildStatus?: string }[];
  /** Lo que arrastran los pedidos y no se pidió aparte; incluye lo que ya estaba activo (para mostrarlo). */
  dependencies: PlannedDependency[];
  /** Dependencias que no se pueden activar solas: hay que resolverlas antes. */
  missing: string[];
}

/**
 * Qué pasaría al activar VARIOS módulos a la vez (el carrito): une lo que cada uno arrastra sin repetir lo que comparten,
 * separa lo que ya estaba activo y lo que no se puede activar. La cotización lo usa para mostrar el carrito y la activación
 * para aplicarlo, así ven exactamente lo mismo.
 *
 * Un módulo que además es dependencia de otro del carrito se activa UNA vez, como pedido directo (el cliente lo eligió).
 */
export async function planActivation(
  repos: PlanRepositories,
  organizationId: string,
  codes: string[],
): Promise<ActivationPlan> {
  const plan: ActivationPlan = { selected: [], alreadyActive: [], invalid: [], dependencies: [], missing: [] };
  const seenCodes = new Set<string>();
  const requested: Plugin[] = [];

  for (const code of codes) {
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    const plugin = await repos.plugins.findByCode(code);
    if (!plugin) {
      plan.invalid.push({ code, reason: 'not_found' });
      continue;
    }
    // Un módulo privado de otra organización se trata como inexistente (404): no se revela que existe.
    if (!plugin.isVisibleTo(organizationId)) {
      plan.invalid.push({ code, reason: 'not_visible' });
      continue;
    }
    if (plugin.isCore) {
      plan.invalid.push({ code, reason: 'core' });
      continue;
    }
    if (!plugin.isBuyable) {
      plan.invalid.push({ code, reason: 'not_available', buildStatus: plugin.buildStatus });
      continue;
    }
    requested.push(plugin);
  }

  const isActive = async (plugin: Plugin) =>
    (await repos.organizationPlugins.find(organizationId, plugin.id))?.status === 'active';

  for (const plugin of requested) {
    if (await isActive(plugin)) plan.alreadyActive.push(plugin);
    else plan.selected.push(plugin);
  }

  const requestedIds = new Set(requested.map((p) => p.id));
  const seenDeps = new Set<string>();
  const missing = new Set<string>();
  for (const plugin of plan.selected) {
    const transitive = await repos.dependencies.resolveTransitiveDependencies(plugin.id);
    for (const edge of transitive) {
      if (seenDeps.has(edge.dependsOnPluginId) || requestedIds.has(edge.dependsOnPluginId)) continue;
      const dep = await repos.plugins.findById(edge.dependsOnPluginId);
      if (!dep) continue;
      seenDeps.add(dep.id);
      const alreadyActive = await isActive(dep);
      plan.dependencies.push({ plugin: dep, requiredBy: plugin, alreadyActive });
      if (!alreadyActive && (!edge.autoActivate || !dep.isBuyable)) missing.add(dep.code);
    }
  }
  plan.missing = [...missing];
  return plan;
}
