import { describe, expect, it } from 'vitest';
import { GetCatalogUseCase } from '../application/use-cases/get-catalog';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { PluginDependency, OrganizationPlugin } from '../domain/entities';
import { createInMemoryUow, createPlugin } from './helpers';

async function seedCatalogWorld(uow: ReturnType<typeof createInMemoryUow>) {
  const pub = createPlugin({ code: 'pub.one', priceCents: 1000 });
  const wip = createPlugin({ code: 'wip.one', priceCents: 500, buildStatus: 'en_construccion' });
  const privateX = createPlugin({ code: 'custom.x', priceCents: 700, createdForOrganizationId: 'org-x' });
  const privateY = createPlugin({ code: 'custom.y', priceCents: 800, createdForOrganizationId: 'org-y' });
  for (const p of [pub, wip, privateX, privateY]) await uow.repos.plugins.save(p);
  const internal = (uow.repos as unknown as {
    __internals: { deps: Map<string, PluginDependency>; depKey: (x: string, y: string) => string };
  }).__internals;
  internal.deps.set(
    internal.depKey(pub.id, wip.id),
    PluginDependency.create({ pluginId: pub.id, dependsOnPluginId: wip.id }),
  );
  return { pub, wip, privateX, privateY };
}

describe('GetCatalogUseCase', () => {
  it('sin organización (null) → solo públicos; nunca incluye privados de ninguna org', async () => {
    const uow = createInMemoryUow();
    await seedCatalogWorld(uow);
    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const catalog = await useCase.execute(null);

    expect(catalog.map((c) => c.code).sort()).toEqual(['pub.one', 'wip.one']);
    const wip = catalog.find((c) => c.code === 'wip.one')!;
    expect(wip.display_status).toBe('en_construccion');
    expect(wip.is_exclusive).toBe(false);
  });

  it('con organización → públicos + privados propios; NUNCA los privados de otra org', async () => {
    const uow = createInMemoryUow();
    await seedCatalogWorld(uow);
    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const catalog = await useCase.execute('org-x');

    expect(catalog.map((c) => c.code).sort()).toEqual(['custom.x', 'pub.one', 'wip.one']);
    const x = catalog.find((c) => c.code === 'custom.x')!;
    expect(x.is_exclusive).toBe(true);
    expect(x.createdForOrganizationId).toBe('org-x');
  });

  it('display_status: disponible sin fila / comprado con fila active / desactivado con fila disabled', async () => {
    const uow = createInMemoryUow();
    // Plugin simple SIN dependencias para poder activarlo directamente.
    const solo = createPlugin({ code: 'solo.one', priceCents: 1000 });
    await uow.repos.plugins.save(solo);
    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    // Sin fila
    let item = (await useCase.execute('org-x')).find((c) => c.code === 'solo.one')!;
    expect(item.display_status).toBe('disponible');

    // Activado → comprado
    await new ActivatePluginUseCase(uow).execute('org-x', solo.code);
    item = (await useCase.execute('org-x')).find((c) => c.code === 'solo.one')!;
    expect(item.display_status).toBe('comprado');

    // Desactivado (queda fila disabled)
    const rows = await uow.repos.organizationPlugins.listByOrganization('org-x');
    for (const row of rows.filter((r) => r.pluginId === solo.id)) {
      row.deactivate();
      await uow.repos.organizationPlugins.save(row);
    }
    item = (await useCase.execute('org-x')).find((c) => c.code === 'solo.one')!;
    expect(item.display_status).toBe('desactivado');
  });

  it('en_construccion mantiene display_status aunque exista una fila vieja de organization_plugins', async () => {
    const uow = createInMemoryUow();
    const { wip } = await seedCatalogWorld(uow);

    await uow.repos.organizationPlugins.save(OrganizationPlugin.activateDirect('org-x', wip.id));

    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );
    const item = (await useCase.execute('org-x')).find((c) => c.code === 'wip.one')!;
    expect(item.display_status).toBe('en_construccion');

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-x');
    expect(rows).toHaveLength(1);
  });

  it('depends_on embebido con código, nombre y auto_activate', async () => {
    const uow = createInMemoryUow();
    await seedCatalogWorld(uow);
    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const catalog = await useCase.execute('org-x');
    const pub = catalog.find((c) => c.code === 'pub.one')!;
    expect(pub.depends_on).toEqual([
      { code: 'wip.one', name: 'Plugin de prueba', autoActivate: true },
    ]);
  });

  it('todos los items exponen imageUrl aunque sea NULL', async () => {
    const uow = createInMemoryUow();
    await seedCatalogWorld(uow);
    const useCase = new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const catalog = await useCase.execute(null);
    expect(catalog.length).toBeGreaterThan(0);
    for (const item of catalog) {
      expect('imageUrl' in item).toBe(true);
      expect(item.imageUrl).toBeNull();
    }
  });
});
