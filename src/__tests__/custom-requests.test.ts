import { describe, expect, it } from 'vitest';
import { RequestCustomPluginUseCase } from '../application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from '../application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from '../application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from '../application/use-cases/reject-custom-plugin-request';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import {
  CustomRequestNotFoundError,
  InvalidCustomRequestStateError,
  PluginNotFoundError,
  PluginNotVisibleToOrganizationError,
} from '../domain/errors';
import { createInMemoryUow, createPlugin, seedExampleWorld } from './helpers';

describe('RequestCustomPluginUseCase', () => {
  it('crea la solicitud en requested; NO toca plugins ni organization_plugins', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const internal = (uow.repos as unknown as {
      __internals: { plugins: Map<string, unknown>; orgPlugins: Map<string, unknown> };
    }).__internals;
    const pluginsBefore = internal.plugins.size;
    const orgPluginsBefore = internal.orgPlugins.size;

    const useCase = new RequestCustomPluginUseCase(uow);
    const request = await useCase.execute({
      organizationId: 'org-1',
      description: 'Quiero algo parecido a A pero con reportes',
      basedOnPluginCodes: ['mod.a'],
    });

    expect(request.status).toBe('requested');
    expect(request.resultingPluginId).toBeNull();
    expect(internal.plugins.size).toBe(pluginsBefore);
    expect(internal.orgPlugins.size).toBe(orgPluginsBefore);

    const events = uow.repos.events.filter((e) => e.type === 'plugin.custom_request.created');
    expect(events).toHaveLength(1);
    expect(events[0].payload.organizationId).toBe('org-1');
  });

  it('código de referencia inexistente → PluginNotFoundError', async () => {
    const uow = createInMemoryUow();
    const useCase = new RequestCustomPluginUseCase(uow);

    await expect(
      useCase.execute({ organizationId: 'org-1', description: 'x', basedOnPluginCodes: ['no.existe'] }),
    ).rejects.toThrow(PluginNotFoundError);
  });

  it('plugin privado de otra org como referencia → PluginNotFoundError (no revela cross-org)', async () => {
    const uow = createInMemoryUow();
    const privateOfY = createPlugin({ code: 'custom.y', priceCents: 1, createdForOrganizationId: 'org-y' });
    await uow.repos.plugins.save(privateOfY);
    const useCase = new RequestCustomPluginUseCase(uow);

    await expect(
      useCase.execute({ organizationId: 'org-1', description: 'x', basedOnPluginCodes: ['custom.y'] }),
    ).rejects.toThrow(PluginNotFoundError);
  });
});

describe('ListMyCustomRequestsUseCase', () => {
  it('solo lista las solicitudes de la propia organización', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'de org-1',
      basedOnPluginCodes: [],
    });
    await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-2',
      description: 'de org-2',
      basedOnPluginCodes: [],
    });

    const mine = await new ListMyCustomRequestsUseCase(uow.repos.customRequests).execute('org-1');
    expect(mine).toHaveLength(1);
    expect(mine[0].organizationId).toBe('org-1');
  });
});

describe('FulfillCustomPluginRequestUseCase', () => {
  it('crea el plugin PRIVADO, marca created y NO inserta ninguna fila en organization_plugins', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const request = await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'A medida',
      basedOnPluginCodes: ['mod.a'],
    });

    const useCase = new FulfillCustomPluginRequestUseCase(uow);
    const plugin = await useCase.execute({
      requestId: request.id,
      name: 'Mi plugin',
      description: 'Descripción cotizada',
      priceCents: 1500,
    });

    expect(plugin.createdForOrganizationId).toBe('org-1');
    expect(plugin.isPublic).toBe(false);
    expect(plugin.code).toBe(`custom.${request.id}`);
    expect(plugin.basedOnPluginId).toBe(
      (await uow.repos.plugins.findByCode('mod.a'))!.id,
    );

    const stored = await uow.repos.customRequests.findById(request.id);
    expect(stored?.status).toBe('created');
    expect(stored?.resultingPluginId).toBe(plugin.id);

    const orgRows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(orgRows).toHaveLength(0);

    const types = uow.repos.events.map((e) => e.type);
    expect(types).toContain('plugin.created');
    expect(types).toContain('plugin.custom_request.fulfilled');
  });

  it('el cliente puede activar su plugin privado después; otra org recibe 404', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const request = await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'A medida',
      basedOnPluginCodes: ['mod.a'],
    });
    const plugin = await new FulfillCustomPluginRequestUseCase(uow).execute({
      requestId: request.id,
      name: 'Mi plugin',
      description: 'Desc',
      priceCents: 1500,
    });

    // El dueño sí puede activarlo
    const activated = await new ActivatePluginUseCase(uow).execute('org-1', plugin.code);
    expect(activated.map((r) => r.pluginCode)).toContain(plugin.code);

    // Otra organización ni siquiera lo ve → PluginNotVisibleToOrganizationError
    await expect(new ActivatePluginUseCase(uow).execute('org-2', plugin.code)).rejects.toThrow(
      PluginNotVisibleToOrganizationError,
    );
  });

  it('fulfill sobre una solicitud ya created → InvalidCustomRequestStateError', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const request = await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'A medida',
      basedOnPluginCodes: [],
    });
    const useCase = new FulfillCustomPluginRequestUseCase(uow);
    await useCase.execute({ requestId: request.id, name: 'X', description: 'Y', priceCents: 100 });

    await expect(
      useCase.execute({ requestId: request.id, name: 'X2', description: 'Y2', priceCents: 200 }),
    ).rejects.toThrow(InvalidCustomRequestStateError);
  });

  it('requestId inexistente → CustomRequestNotFoundError', async () => {
    const uow = createInMemoryUow();
    const useCase = new FulfillCustomPluginRequestUseCase(uow);

    await expect(
      useCase.execute({ requestId: '11111111-1111-4111-8111-111111111111', name: 'X', description: 'Y', priceCents: 100 }),
    ).rejects.toThrow(CustomRequestNotFoundError);
  });

  it('sin basedOnPluginId explícito usa el primero de la solicitud; categoría heredada', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const request = await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'A medida',
      basedOnPluginCodes: ['mod.a'],
    });

    const plugin = await new FulfillCustomPluginRequestUseCase(uow).execute({
      requestId: request.id,
      name: 'Hereda',
      description: 'Desc',
      priceCents: 900,
    });

    expect(plugin.category).toBe((await uow.repos.plugins.findByCode('mod.a'))!.category);
  });
});

describe('RejectCustomPluginRequestUseCase', () => {
  it('rechaza con razón y emite evento; luego no se puede fulfill', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const request = await new RequestCustomPluginUseCase(uow).execute({
      organizationId: 'org-1',
      description: 'A medida',
      basedOnPluginCodes: [],
    });

    const rejected = await new RejectCustomPluginRequestUseCase(uow).execute(request.id, 'Fuera de alcance');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Fuera de alcance');

    const events = uow.repos.events.filter((e) => e.type === 'plugin.custom_request.rejected');
    expect(events).toHaveLength(1);

    await expect(
      new FulfillCustomPluginRequestUseCase(uow).execute({
        requestId: request.id,
        name: 'X',
        description: 'Y',
        priceCents: 100,
      }),
    ).rejects.toThrow(InvalidCustomRequestStateError);
  });

  it('id inexistente → CustomRequestNotFoundError', async () => {
    const uow = createInMemoryUow();
    await expect(
      new RejectCustomPluginRequestUseCase(uow).execute('11111111-1111-4111-8111-111111111111', 'razón'),
    ).rejects.toThrow(CustomRequestNotFoundError);
  });
});
