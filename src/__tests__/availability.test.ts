import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import {
  MissingDependenciesError,
  PluginNotAvailableError,
} from '../domain/errors';
import { PluginDependency } from '../domain/entities';
import { createInMemoryUow, createPlugin } from './helpers';

describe('ActivatePluginUseCase — disponibilidad por build_status', () => {
  it('plugin en_construccion → PluginNotAvailableError, sin tocar organization_plugins', async () => {
    const uow = createInMemoryUow();
    const wip = createPlugin({ code: 'mod.wip', priceCents: 100, buildStatus: 'en_construccion' });
    await uow.repos.plugins.save(wip);
    const useCase = new ActivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', wip.code)).rejects.toThrow(PluginNotAvailableError);

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows).toHaveLength(0);
    expect(uow.repos.events.filter((e) => e.type === 'plugin.activated')).toHaveLength(0);
  });

  it('A disponible que depende de B en_construccion → MissingDependenciesError([B]), no activa ni A ni B', async () => {
    const uow = createInMemoryUow();
    const a = createPlugin({ code: 'mod.a', priceCents: 2000 });
    const b = createPlugin({ code: 'mod.b', priceCents: 1000, buildStatus: 'en_construccion' });
    await uow.repos.plugins.save(a);
    await uow.repos.plugins.save(b);
    const internal = (uow.repos as unknown as {
      __internals: { deps: Map<string, PluginDependency>; depKey: (x: string, y: string) => string };
    }).__internals;
    internal.deps.set(internal.depKey(a.id, b.id), PluginDependency.create({ pluginId: a.id, dependsOnPluginId: b.id }));

    const useCase = new ActivatePluginUseCase(uow);

    const err = await useCase.execute('org-1', a.code).catch((e) => e);
    expect(err).toBeInstanceOf(MissingDependenciesError);
    expect((err as MissingDependenciesError).missing).toEqual(['mod.b']);

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows).toHaveLength(0);
  });

  it('descontinuado tampoco se puede activar', async () => {
    const uow = createInMemoryUow();
    const dead = createPlugin({ code: 'mod.dead', priceCents: 100, buildStatus: 'descontinuado' });
    await uow.repos.plugins.save(dead);
    const useCase = new ActivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', dead.code)).rejects.toThrow(PluginNotAvailableError);
  });
});
