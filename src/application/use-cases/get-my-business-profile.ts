import { BusinessProfileDTO } from '../dtos';
import {
  BusinessProfileRepository,
  BusinessProfileTranslation,
  OrganizationBusinessProfileRepository,
} from '../../domain/repositories';
import { BASE_LOCALE } from '../localization';

/**
 * El perfil elegido (o su ausencia) por la organización. Devuelve `{ status:
 * "pending" }` cuando no hay fila: el alta aún no ha decidido.
 */
export class GetMyBusinessProfileUseCase {
  constructor(
    private readonly profiles: BusinessProfileRepository,
    private readonly orgProfiles: OrganizationBusinessProfileRepository,
  ) {}

  async execute(organizationId: string, locale: string = BASE_LOCALE) {
    const row = await this.orgProfiles.find(organizationId);
    if (!row) return { status: 'pending' } as const;

    if (row.businessProfileId === null) {
      return { status: row.status, profile: null, decidedAt: row.decidedAt } as const;
    }

    const profile = await this.profiles.findTranslation(row.businessProfileId, locale);
    let base: BusinessProfileDTO | null = null;
    const bp = await this.profiles.findById(row.businessProfileId);
    if (bp) {
      const tr: BusinessProfileTranslation | undefined = profile ?? undefined;
      base = {
        code: bp.code,
        name: tr?.name || bp.name,
        description: tr?.description || bp.description,
        icon: bp.icon,
        status: row.status,
      };
    }

    return { status: row.status, profile: base, decidedAt: row.decidedAt } as const;
  }
}