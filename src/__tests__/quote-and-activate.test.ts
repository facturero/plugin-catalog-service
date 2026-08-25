import { describe, expect, it } from 'vitest';
import { QuoteActivationUseCase } from '../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { OrganizationPlugin } from '../domain/entities';
import { PluginAlreadyActiveError, PluginNotVisibleToOrganizationError } from '../domain/errors';
import { createInMemoryUow, createPlugin, seedExampleWorld } from './helpers';

describe('QuoteActivationUseCase', () => {
  it('activar A sin tener B → requires [B, already_active=false] y total 3000 (A=$20 + B=$10)', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    const useCase = new QuoteActivationUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const quote = await useCase.execute('org-1', a.code);

    expect(quote.plugin.code).toBe('mod.a');
    expect(quote.price).toBe(2000);
    expect(quote.requires).toHaveLength(2);
    expect(quote.requires.map((r) => r.plugin.code)).toEqual(['mod.b', 'mod.c']);
    expect(quote.requires.every((r) => !r.already_active)).toBe(true);
    expect(quote.total_monthly).toBe(3500);
  });

  it('si B ya está activo, el total baja y B aparece con already_active=true', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    await uow.repos.organizationPlugins.save(
      OrganizationPlugin.activateDirect('org-1', b.id),
    );
    const useCase = new QuoteActivationUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
    );

    const quote = await useCase.execute('org-1', a.code);

    const bReq = quote.requires.find((r) => r.plugin.code === 'mod.b')!;
    expect(bReq.already_active).toBe(true);
    expect(quote.total_monthly).toBe(2500);
  });
});

describe('ActivatePluginUseCase', () => {
  it('activa A → A queda direct y sus dependencias dependency con required_by=A; emite un plugin.activated por cada uno', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    const useCase = new ActivatePluginUseCase(uow);

    const result = await useCase.execute('org-1', a.code);

    expect(result).toHaveLength(3);
    const aRow = result.find((r) => r.pluginCode === 'mod.a')!;
    expect(aRow.activationSource).toBe('direct');
    expect(aRow.requiredByPluginId).toBeNull();

    const bRow = result.find((r) => r.pluginCode === 'mod.b')!;
    expect(bRow.activationSource).toBe('dependency');
    expect(bRow.requiredByPluginId).toBe(a.id);

    const persistedB = await uow.repos.organizationPlugins.find('org-1', bRow.pluginId);
    expect(persistedB?.status).toBe('active');

    const activatedEvents = uow.repos.events.filter((e) => e.type === 'plugin.activated');
    expect(activatedEvents).toHaveLength(3);
    expect(new Set(activatedEvents.map((e) => e.aggregateId))).toHaveLength(3);
  });

  it('activar A cuando B ya estaba activo direct NO duplica ni sobreescribe su activation_source', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    const originalDirect = OrganizationPlugin.activateDirect('org-1', b.id);
    await uow.repos.organizationPlugins.save(originalDirect);

    const useCase = new ActivatePluginUseCase(uow);
    await useCase.execute('org-1', a.code);

    const bRow = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(bRow?.activationSource).toBe('direct');
    expect(bRow?.requiredByPluginId).toBeNull();
    expect(bRow?.activatedAt.getTime()).toBe(originalDirect.activatedAt.getTime());
  });

  it('dependencia transitiva (A→B→C): activar A activa a los tres', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    const useCase = new ActivatePluginUseCase(uow);

    await useCase.execute('org-1', a.code);

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('active');
    }
  });

  it('plugin ya activo → PluginAlreadyActiveError', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    const useCase = new ActivatePluginUseCase(uow);
    await useCase.execute('org-1', a.code);

    await expect(useCase.execute('org-1', a.code)).rejects.toThrow(PluginAlreadyActiveError);
  });

  it('cross-org: activar desde org-1 un plugin privado de org-2 → PluginNotVisibleToOrganizationError (404)', async () => {
    const uow = createInMemoryUow();
    const privateOfOrg2 = createPlugin({
      code: 'custom.private',
      priceCents: 100,
      createdForOrganizationId: 'org-2',
    });
    await uow.repos.plugins.save(privateOfOrg2);
    const useCase = new ActivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', privateOfOrg2.code)).rejects.toThrow(
      PluginNotVisibleToOrganizationError,
    );
  });
});
