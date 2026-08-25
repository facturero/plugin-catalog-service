import { UnitOfWork } from '../application/ports';
import {
  DomainEvent,
  OrganizationPluginRepository,
  OutboxRepository,
  PluginCustomRequestRepository,
  PluginDependencyRepository,
  PluginRepository,
  Repositories,
} from '../domain/repositories';
import { PluginDependencyCycleError } from '../domain/errors';
import {
  OrganizationPlugin,
  Plugin,
  PluginCustomRequest,
  PluginDependency,
} from '../domain/entities';

export function createPlugin(params: Partial<{
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  buildStatus: 'disponible' | 'en_construccion' | 'descontinuado';
  priceCents: number;
  isActive: boolean;
  createdForOrganizationId: string | null;
}>): Plugin {
  return Plugin.create({
    code: params.code ?? 'test.plugin',
    name: params.name ?? 'Plugin de prueba',
    category: params.category ?? 'Pruebas',
    description: params.description ?? 'Descripción de prueba.',
    priceCents: params.priceCents ?? 0,
    buildStatus: params.buildStatus ?? 'disponible',
    isActive: params.isActive ?? true,
    createdForOrganizationId: params.createdForOrganizationId ?? null,
    ...(params.id ? { id: params.id } : {}),
  });
}

export function createInMemoryRepositories(): Repositories & { events: DomainEvent[] } {
  const plugins = new Map<string, Plugin>();
  const deps = new Map<string, PluginDependency>();
  const orgPlugins = new Map<string, OrganizationPlugin>();
  const requests = new Map<string, PluginCustomRequest>();
  const events: DomainEvent[] = [];

  const depKey = (pluginId: string, dependsOn: string) => `${pluginId}->${dependsOn}`;

  const pluginRepo: PluginRepository = {
    async findByCode(code) {
      return Array.from(plugins.values()).find((p) => p.code === code) ?? null;
    },
    async findById(id) {
      return plugins.get(id) ?? null;
    },
    async listAll() {
      return Array.from(plugins.values()).sort((a, b) => a.code.localeCompare(b.code));
    },
    async listByCodes(codes) {
      const set = new Set(codes);
      return Array.from(plugins.values()).filter((p) => set.has(p.code));
    },
    async listVisibleTo(organizationId) {
      return Array.from(plugins.values())
        .filter((p) => p.isVisibleTo(organizationId))
        .sort((a, b) => a.code.localeCompare(b.code));
    },
    async save(plugin) {
      plugins.set(plugin.id, Plugin.fromPersistence({ ...plugin.toPersistence() }));
    },
  };

  const dependencyRepo: PluginDependencyRepository = {
    async listAll() {
      return Array.from(deps.values());
    },
    async listDependenciesOf(pluginId) {
      return Array.from(deps.values()).filter((d) => d.pluginId === pluginId);
    },
    async listDependentsOf(pluginId) {
      return Array.from(deps.values()).filter((d) => d.dependsOnPluginId === pluginId);
    },
    async resolveTransitiveDependencies(pluginId) {
      const adj = new Map<string, PluginDependency[]>();
      for (const d of deps.values()) {
        if (!adj.has(d.pluginId)) adj.set(d.pluginId, []);
        adj.get(d.pluginId)!.push(d);
      }
      const WHITE = 0;
      const GRAY = 1;
      const BLACK = 2;
      const color = new Map<string, number>([[pluginId, WHITE]]);
      const found = new Map<string, PluginDependency>();
      const dfs = (node: string): void => {
        color.set(node, GRAY);
        for (const edge of adj.get(node) ?? []) {
          const c = color.get(edge.dependsOnPluginId) ?? WHITE;
          if (c === GRAY) throw new PluginDependencyCycleError();
          if (c === WHITE) {
            color.set(edge.dependsOnPluginId, WHITE);
            found.set(edge.dependsOnPluginId, edge);
            dfs(edge.dependsOnPluginId);
          }
        }
        color.set(node, BLACK);
      };
      dfs(pluginId);
      return [...found.values()];
    },
  };

  const orgPluginRepo: OrganizationPluginRepository = {
    async listByOrganization(organizationId) {
      return Array.from(orgPlugins.values()).filter((r) => r.organizationId === organizationId);
    },
    async find(organizationId, pluginId) {
      return orgPlugins.get(`${organizationId}:${pluginId}`) ?? null;
    },
    async save(op) {
      orgPlugins.set(`${op.organizationId}:${op.pluginId}`, OrganizationPlugin.fromPersistence({ ...op.toPersistence() }));
    },
    async delete(organizationId, pluginId) {
      orgPlugins.delete(`${organizationId}:${pluginId}`);
    },
  };

  const requestRepo: PluginCustomRequestRepository = {
    async findById(id) {
      return requests.get(id) ?? null;
    },
    async listByOrganization(organizationId) {
      return Array.from(requests.values()).filter((r) => r.organizationId === organizationId);
    },
    async save(request) {
      requests.set(request.id, PluginCustomRequest.fromPersistence(request.toPersistence()));
    },
  };

  const outbox: OutboxRepository = {
    async add(event) {
      events.push({ ...event });
    },
  };

  return {
    events,
    __internals: { plugins, deps, orgPlugins, requests, depKey },
    plugins: pluginRepo,
    dependencies: dependencyRepo,
    organizationPlugins: orgPluginRepo,
    customRequests: requestRepo,
    outbox,
  } as Repositories & {
    events: DomainEvent[];
    __internals: {
      plugins: Map<string, Plugin>;
      deps: Map<string, PluginDependency>;
      orgPlugins: Map<string, OrganizationPlugin>;
      requests: Map<string, PluginCustomRequest>;
      depKey: (a: string, b: string) => string;
    };
  };
}

export function createInMemoryUow(): UnitOfWork & { repos: Repositories & { events: DomainEvent[] } } {
  const repos = createInMemoryRepositories();
  return {
    repos,
    execute<T>(work: (r: Repositories) => Promise<T>): Promise<T> {
      return work(repos);
    },
  };
}

/** Mundo del enunciado: A cuesta $20 y depende de B ($10). C para probar transitivas. */
export function seedExampleWorld(repos: Repositories): { a: Plugin; b: Plugin; c: Plugin } {
  const a = createPlugin({ code: 'mod.a', name: 'Plugin A', priceCents: 2000 });
  const b = createPlugin({ code: 'mod.b', name: 'Plugin B', priceCents: 1000 });
  const c = createPlugin({ code: 'mod.c', name: 'Plugin C', priceCents: 500 });
  void repos.plugins.save(a);
  void repos.plugins.save(b);
  void repos.plugins.save(c);
  void repos.dependencies.listAll();
  const internal = (repos as unknown as { __internals: { deps: Map<string, PluginDependency>; depKey: (x: string, y: string) => string } }).__internals;
  internal.deps.set(
    internal.depKey(a.id, b.id),
    PluginDependency.create({ pluginId: a.id, dependsOnPluginId: b.id }),
  );
  internal.deps.set(
    internal.depKey(b.id, c.id),
    PluginDependency.create({ pluginId: b.id, dependsOnPluginId: c.id }),
  );
  return { a, b, c };
}
