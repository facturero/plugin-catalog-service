import { PluginCustomRequestDTO } from '../dtos';
import { PluginCustomRequestRepository } from '../../domain/repositories';
import { toDto } from './request-custom-plugin';

export class ListMyCustomRequestsUseCase {
  constructor(private readonly customRequests: PluginCustomRequestRepository) {}

  async execute(organizationId: string): Promise<PluginCustomRequestDTO[]> {
    const rows = await this.customRequests.listByOrganization(organizationId);
    return rows.map(toDto);
  }
}
