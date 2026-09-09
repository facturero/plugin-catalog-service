import { describe, expect, it } from 'vitest';
import { ChooseBusinessProfileUseCase } from '../application/use-cases/choose-business-profile';
import { GetMyBusinessProfileUseCase } from '../application/use-cases/get-my-business-profile';
import { BusinessProfile } from '../domain/entities';
import { BusinessProfileTranslation } from '../domain/repositories';
import { createInMemoryUow } from './helpers';

type Internals = {
  profiles: Map<string, BusinessProfile>;
  profileTranslations: Map<string, BusinessProfileTranslation>;
};

function seedProfiles(uow: ReturnType<typeof createInMemoryUow>): BusinessProfile {
  const internal = (uow.repos as unknown as { __internals: Internals }).__internals;
  const farmacia = BusinessProfile.create({
    code: 'health.pharmacy',
    name: 'Farmacia',
    description: 'Mostrador, lotes y caducidad.',
  });
  internal.profiles.set(farmacia.id, farmacia);
  internal.profileTranslations.set(`en|${farmacia.id}`, {
    businessProfileId: farmacia.id,
    name: 'Pharmacy',
    description: 'Counter sales, lots and expiry.',
  });
  return farmacia;
}

describe('ChooseBusinessProfileUseCase', () => {
  it('elegir un perfil lo guarda y devuelve el elegido, no un hueco', async () => {
    // Regresión: la respuesta se armaba desestructurando `execute` del caso de
    // uso de consulta, con lo que el método perdía su `this` y la petición
    // moría con un 500 ("Cannot read properties of undefined").
    const uow = createInMemoryUow();
    const farmacia = seedProfiles(uow);

    const result = await new ChooseBusinessProfileUseCase(uow).execute({
      organizationId: 'org-1',
      userId: 'user-1',
      code: 'health.pharmacy',
    });

    expect(result.status).toBe('selected');
    expect(result.profile?.code).toBe(farmacia.code);
    expect(await uow.repos.organizationBusinessProfiles.find('org-1')).not.toBeNull();
  });

  it('devuelve el perfil en el idioma pedido', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);

    const result = await new ChooseBusinessProfileUseCase(uow).execute({
      organizationId: 'org-1',
      userId: 'user-1',
      code: 'health.pharmacy',
      locale: 'en',
    });

    expect(result.profile?.name).toBe('Pharmacy');
  });

  it('omitir guarda la decisión sin perfil, que no es lo mismo que no decidir', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);

    const result = await new ChooseBusinessProfileUseCase(uow).execute({
      organizationId: 'org-1',
      userId: 'user-1',
      code: null,
    });

    expect(result.status).toBe('skipped');
    expect(result.profile).toBeNull();
  });

  it('elegir dos veces es idempotente: la segunda gana y no duplica', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);
    const useCase = new ChooseBusinessProfileUseCase(uow);

    await useCase.execute({ organizationId: 'org-1', userId: 'user-1', code: null });
    const result = await useCase.execute({
      organizationId: 'org-1',
      userId: 'user-1',
      code: 'health.pharmacy',
    });

    expect(result.status).toBe('selected');
    expect(result.profile?.code).toBe('health.pharmacy');
  });

  it('publica el evento de auditoría con quién decidió y de dónde viene', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);

    await new ChooseBusinessProfileUseCase(uow).execute({
      organizationId: 'org-1',
      userId: 'user-1',
      code: 'health.pharmacy',
      source: 'settings',
    });

    const event = uow.repos.events.find((e) => e.type === 'plugin.business_profile.selected');
    expect(event).toBeDefined();
    expect(event?.payload).toMatchObject({
      organizationId: 'org-1',
      profileCode: 'health.pharmacy',
      status: 'selected',
      decidedByUserId: 'user-1',
      source: 'settings',
    });
  });

  it('un código que no existe se rechaza y no deja nada guardado', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);

    await expect(
      new ChooseBusinessProfileUseCase(uow).execute({
        organizationId: 'org-1',
        userId: 'user-1',
        code: 'no.existe',
      }),
    ).rejects.toThrow();
    expect(await uow.repos.organizationBusinessProfiles.find('org-1')).toBeNull();
  });
});

describe('GetMyBusinessProfileUseCase', () => {
  it('sin fila devuelve pendiente: el alta todavía no ha decidido', async () => {
    const uow = createInMemoryUow();
    seedProfiles(uow);

    const result = await new GetMyBusinessProfileUseCase(
      uow.repos.businessProfiles,
      uow.repos.organizationBusinessProfiles,
    ).execute('org-sin-nada');

    expect(result.status).toBe('pending');
  });
});
