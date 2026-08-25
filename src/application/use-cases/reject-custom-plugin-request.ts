import { UnitOfWork } from '../ports';
import { PluginCustomRequestDTO } from '../dtos';
import {
  CustomRequestNotFoundError,
  InvalidCustomRequestStateError,
} from '../../domain/errors';
import { toDto } from './request-custom-plugin';

export class RejectCustomPluginRequestUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(requestId: string, reason: string): Promise<PluginCustomRequestDTO> {
    return this.uow.execute(async (repos) => {
      const request = await repos.customRequests.findById(requestId);
      if (!request) throw new CustomRequestNotFoundError();
      try {
        request.reject(reason);
      } catch {
        throw new InvalidCustomRequestStateError();
      }
      await repos.customRequests.save(request);

      await repos.outbox.add({
        type: 'plugin.custom_request.rejected',
        aggregateType: 'plugin_custom_request',
        aggregateId: request.id,
        payload: {
          requestId: request.id,
          organizationId: request.organizationId,
          reason,
        },
        occurredAt: new Date(),
      });

      return toDto(request);
    });
  }
}
