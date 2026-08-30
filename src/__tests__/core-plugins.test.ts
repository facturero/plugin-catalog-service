import { describe, expect, it } from 'vitest';
import { GetCatalogUseCase } from '../application/use-cases/get-catalog';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../application/use-cases/deactivate-plugin';
import { CorePluginNotConfigurableError } from '../domain/errors';
import { createInMemoryUow, createPlugin } from './helpers';

/**
 * El núcleo (multi-tenencia, RBAC, catálogo de productos, gateway, catálogo fiscal)
 * está activo para todas las organizaciones: se muestra como "incluido" y ni se
 * compra ni se apaga.
 */
describe('plugins del núcleo', () => {
  async function seedWorld() {
    const uow = createInMemoryUow();
    const core = createPlugin({ code: 'admin.multitenant', isCore: true, priceCents: 0 });
    const vendible = createPlugin({ code: 'crm.contacts', priceCents: 1500 });
    await uow.repos.plugins.save(core);
    await uow.repos.plugins.save(vendible);
    return { uow, core, vendible };
  }

  it('aparece en el catálogo con display_status "incluido"', async () => {
    const { uow, core, vendible } = await seedWorld();
    const catalog = await new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    ).execute('org-1');

    const byCode = new Map(catalog.map((p) => [p.code, p]));
    expect(byCode.get(core.code)?.display_status).toBe('incluido');
    expect(byCode.get(core.code)?.isCore).toBe(true);
    expect(byCode.get(vendible.code)?.display_status).toBe('disponible');
    expect(byCode.get(vendible.code)?.isCore).toBe(false);
  });

  it('no se puede activar', async () => {
    const { uow, core } = await seedWorld();
    await expect(new ActivatePluginUseCase(uow).execute('org-1', core.code)).rejects.toBeInstanceOf(
      CorePluginNotConfigurableError,
    );
  });

  it('no se puede desactivar', async () => {
    const { uow, core } = await seedWorld();
    await expect(
      new DeactivatePluginUseCase(uow).execute('org-1', core.code),
    ).rejects.toBeInstanceOf(CorePluginNotConfigurableError);
  });

  it('nunca es comprable, aunque esté disponible y activo', async () => {
    const core = createPlugin({ code: 'infra.catalog_products', isCore: true });
    expect(core.buildStatus).toBe('disponible');
    expect(core.isActive).toBe(true);
    expect(core.isBuyable).toBe(false);
  });
});
