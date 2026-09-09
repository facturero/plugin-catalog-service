import { UnitOfWork } from '../ports';
import { ChooseBusinessProfileInput } from '../dtos';
import { BusinessProfileNotFoundError } from '../../domain/errors';
import { OrganizationBusinessProfile } from '../../domain/entities';
import { GetMyBusinessProfileUseCase } from './get-my-business-profile';

/**
 * Elige (o descarta) el perfil de negocio de la organización. Idempotente:
 * elegir un perfil ya elegido lo vuelve a guardar sin error. Publica
 * `plugin.business_profile.selected` por el outbox para auditoría.
 */
export class ChooseBusinessProfileUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: ChooseBusinessProfileInput) {
    return this.uow.execute(async (repos) => {
      const { organizationId, userId, code } = input;

      let profileId: string | null = null;
      if (code) {
        const profile = await repos.businessProfiles.findByCode(code);
        if (!profile || !profile.isActive) throw new BusinessProfileNotFoundError();
        profileId = profile.id;
      }

      const obp = code
        ? OrganizationBusinessProfile.choose(organizationId, profileId!, userId)
        : OrganizationBusinessProfile.skip(organizationId, userId);

      await repos.organizationBusinessProfiles.upsert(obp);

      await repos.outbox.add({
        type: 'plugin.business_profile.selected',
        aggregateType: 'business_profile',
        aggregateId: organizationId,
        payload: {
          organizationId,
          profileCode: code,
          status: obp.status,
          decidedByUserId: userId,
          source: input.source ?? 'onboarding',
        },
        occurredAt: new Date(),
      });

      // Ojo con desestructurar `execute`: el método se queda sin `this` y la
      // primera línea que toque un repositorio revienta con "Cannot read
      // properties of undefined". Se llama sobre la instancia.
      const getMine = new GetMyBusinessProfileUseCase(
        repos.businessProfiles,
        repos.organizationBusinessProfiles,
      );
      return getMine.execute(organizationId, input.locale);
    });
  }
}