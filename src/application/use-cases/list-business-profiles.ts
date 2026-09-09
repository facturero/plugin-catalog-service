import { BusinessProfileDTO } from '../dtos';
import {
  BusinessProfileRepository,
  BusinessProfileTranslation,
} from '../../domain/repositories';
import { BASE_LOCALE } from '../localization';

/**
 * Perfiles activos, localizados. Público: no necesita organización ni permiso
 * (es catálogo, como el listado de plugins públicos).
 */
export class ListBusinessProfilesUseCase {
  constructor(
    private readonly profiles: BusinessProfileRepository,
  ) {}

  async execute(locale: string = BASE_LOCALE): Promise<BusinessProfileDTO[]> {
    const profiles = await this.profiles.listActive();
    const translations =
      locale === BASE_LOCALE
        ? new Map<string, BusinessProfileTranslation>()
        : new Map(
            (await Promise.all(
              profiles.map((p) => this.profiles.findTranslation(p.id, locale)),
            ))
              .filter((t): t is BusinessProfileTranslation => t !== null)
              .map((t) => [t.businessProfileId, t]),
          );

    return profiles.map((p) => {
      const tr = translations.get(p.id);
      return {
        code: p.code,
        name: tr?.name || p.name,
        description: tr?.description || p.description,
        icon: p.icon,
      };
    });
  }
}