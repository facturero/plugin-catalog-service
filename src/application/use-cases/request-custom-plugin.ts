import { UnitOfWork } from '../ports';
import { RequestCustomPluginInput, PluginCustomRequestDTO } from '../dtos';
import { PluginNotFoundError } from '../../domain/errors';
import { PluginCustomRequest as CustomRequestEntity } from '../../domain/entities';

export class RequestCustomPluginUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: RequestCustomPluginInput): Promise<PluginCustomRequestDTO> {
    return this.uow.execute(async (repos) => {
      const uniqueCodes = [...new Set(input.basedOnPluginCodes)];
      const found = await repos.plugins.listByCodes(uniqueCodes);
      const visible = found.filter((p) => p.isVisibleTo(input.organizationId));
      if (visible.length < uniqueCodes.length) throw new PluginNotFoundError();

      const request = CustomRequestEntity.request({
        organizationId: input.organizationId,
        description: input.description,
        basedOnPluginIds: visible.map((p) => p.id),
      });
      await repos.customRequests.save(request);

      await repos.outbox.add({
        type: 'plugin.custom_request.created',
        aggregateType: 'plugin_custom_request',
        aggregateId: request.id,
        payload: {
          organizationId: input.organizationId,
          requestId: request.id,
          basedOnPluginIds: request.basedOnPluginIds,
        },
        occurredAt: new Date(),
      });

      return toDto(request);
    });
  }
}

export function toDto(r: {
  id: string;
  organizationId: string;
  description: string;
  basedOnPluginIds: string[];
  status: 'requested' | 'quoted' | 'created' | 'rejected';
  resultingPluginId: string | null;
  quotedPriceCents: number | null;
  rejectionReason: string | null;
}): PluginCustomRequestDTO {
  return {
    id: r.id,
    organizationId: r.organizationId,
    description: r.description,
    basedOnPluginIds: r.basedOnPluginIds,
    status: r.status,
    resultingPluginId: r.resultingPluginId,
    quotedPriceCents: r.quotedPriceCents,
    rejectionReason: r.rejectionReason,
  };
}
