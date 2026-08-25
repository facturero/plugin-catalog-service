import { UnitOfWork } from '../ports';
import { FulfillCustomPluginRequestInput, PluginDTO } from '../dtos';
import { Plugin } from '../../domain/entities';
import {
  CustomRequestNotFoundError,
  InvalidCustomRequestStateError,
  PluginNotFoundError,
} from '../../domain/errors';
import { toDto } from './quote-activation';

export class FulfillCustomPluginRequestUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: FulfillCustomPluginRequestInput): Promise<PluginDTO> {
    return this.uow.execute(async (repos) => {
      const request = await repos.customRequests.findById(input.requestId);
      if (!request) throw new CustomRequestNotFoundError();
      if (request.status === 'created' || request.status === 'rejected') {
        throw new InvalidCustomRequestStateError();
      }

      let basedOnPluginId = input.basedOnPluginId ?? null;
      if (basedOnPluginId === null && request.basedOnPluginIds.length > 0) {
        basedOnPluginId = request.basedOnPluginIds[0];
      }
      let baseCategory = 'Personalizados';
      if (basedOnPluginId !== null) {
        const base = await repos.plugins.findById(basedOnPluginId);
        if (!base) throw new PluginNotFoundError();
        baseCategory = base.category;
      }

      const plugin = Plugin.create({
        code: `custom.${request.id}`,
        name: input.name,
        category: baseCategory,
        description: input.description,
        imageUrl: input.imageUrl ?? null,
        priceCents: input.priceCents,
        createdForOrganizationId: request.organizationId,
        basedOnPluginId,
      });

      request.fulfill(plugin.id);
      await repos.plugins.save(plugin);
      await repos.customRequests.save(request);

      // Crear ≠ activar: NO se inserta ninguna fila en organization_plugins aquí.

      await repos.outbox.add({
        type: 'plugin.created',
        aggregateType: 'plugin',
        aggregateId: plugin.id,
        payload: {
          pluginId: plugin.id,
          code: plugin.code,
          createdForOrganizationId: plugin.createdForOrganizationId,
          requestId: request.id,
        },
        occurredAt: new Date(),
      });
      await repos.outbox.add({
        type: 'plugin.custom_request.fulfilled',
        aggregateType: 'plugin_custom_request',
        aggregateId: request.id,
        payload: {
          organizationId: request.organizationId,
          requestId: request.id,
          resultingPluginId: plugin.id,
        },
        occurredAt: new Date(),
      });

      return toDto(plugin);
    });
  }
}
