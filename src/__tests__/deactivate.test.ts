import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../application/use-cases/deactivate-plugin';
import { BlockingDependentsError, PluginNotFoundError } from '../domain/errors';
import { OrganizationPlugin } from '../domain/entities';
import { createInMemoryUow, seedExampleWorld } from './helpers';

describe('DeactivatePluginUseCase', () => {
  it('intentar desactivar B mientras A sigue activo → BlockingDependentsError', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const useCase = new DeactivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', b.code)).rejects.toThrow(BlockingDependentsError);
    const bRow = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(bRow?.status).toBe('active');
  });

  it('desactivar A con B y C activados como dependency (cadena A→B→C) → todos se desactivan', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const useCase = new DeactivatePluginUseCase(uow);
    const result = await useCase.execute('org-1', a.code);

    expect(result.map((r) => r.pluginCode).sort()).toEqual(['mod.a', 'mod.b', 'mod.c']);
    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows.every((r) => r.status === 'disabled')).toBe(true);

    const deactivatedEvents = uow.repos.events.filter((e) => e.type === 'plugin.deactivated');
    expect(deactivatedEvents).toHaveLength(3);
  });

  it('desactivar A cuando B fue activado direct → B permanece activo', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    await uow.repos.organizationPlugins.save(OrganizationPlugin.activateDirect('org-1', b.id));
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const result = await new DeactivatePluginUseCase(uow).execute('org-1', a.code);

    expect(result).toHaveLength(1);
    expect(result[0].pluginCode).toBe('mod.a');
    const bRow = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(bRow?.status).toBe('active');
  });

  it('desactivar un plugin que la organización no tiene activo → PluginNotFoundError', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const useCase = new DeactivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', 'mod.a')).rejects.toThrow(PluginNotFoundError);
  });
});
