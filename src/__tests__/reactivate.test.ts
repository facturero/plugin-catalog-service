import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { ApplyDueDeactivationsUseCase } from '../application/use-cases/apply-due-deactivations';
import { DeactivatePluginUseCase } from '../application/use-cases/deactivate-plugin';
import { GetOrganizationPluginsUseCase } from '../application/use-cases/get-organization-plugins';
import { ReactivatePluginUseCase } from '../application/use-cases/reactivate-plugin';
import { paidThroughOfDeactivated } from '../domain/billing-period';
import { PluginAlreadyActiveError, ReactivationNotFreeError } from '../domain/errors';
import { OrganizationPlugin } from '../domain/entities';
import { addMonths, OrganizationTrial } from '../domain/trial';
import { createInMemoryUow, seedExampleWorld } from './helpers';

const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);
const diasDespues = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

describe('hasta cuándo estaba pagado un módulo desactivado', () => {
  const activatedAt = dia('2026-10-08');

  it('desactivado a mitad de periodo: sigue pagado hasta el fin de ese periodo', () => {
    const r = paidThroughOfDeactivated({ activatedAt, deactivatedAt: dia('2026-10-20'), trialEndsAt: null, now: dia('2026-10-25') });
    expect(r).toEqual(dia('2026-11-08'));
  });

  it('desactivado JUSTO al terminar el periodo (la baja programada que se cumple): ya no queda nada pago', () => {
    const r = paidThroughOfDeactivated({ activatedAt, deactivatedAt: dia('2026-11-08'), trialEndsAt: null, now: dia('2026-11-08') });
    expect(r).toBeNull();
  });

  it('pasado el fin del periodo ya no está pagado', () => {
    const r = paidThroughOfDeactivated({ activatedAt, deactivatedAt: dia('2026-10-20'), trialEndsAt: null, now: dia('2026-11-09') });
    expect(r).toBeNull();
  });

  it('desactivado durante la prueba gratis: pagado (gratis) hasta que la prueba termina', () => {
    const r = paidThroughOfDeactivated({ activatedAt, deactivatedAt: dia('2026-10-20'), trialEndsAt: dia('2027-01-08'), now: dia('2026-12-01') });
    expect(r).toEqual(dia('2027-01-08'));
  });
});

describe('reactivar sin costo', () => {
  async function mundo() {
    const uow = createInMemoryUow();
    const { a, b, c } = seedExampleWorld(uow.repos);
    const activate = new ActivatePluginUseCase(uow);
    const deactivate = new DeactivatePluginUseCase(uow);
    await activate.execute('org-1', a.code);
    const original = (await uow.repos.organizationPlugins.find('org-1', a.id))!;
    return { uow, a, b, c, activate, deactivate, original, reactivate: new ReactivatePluginUseCase(uow) };
  }

  it('desactivado antes de que terminara lo pagado: se restaura sin pasar por el carrito, con sus dependencias y su fecha original', async () => {
    const { uow, a, deactivate, reactivate, original } = await mundo();
    await deactivate.applyNow('org-1', a.code); // baja inmediata: mitad de periodo
    const ahora = diasDespues(original.activatedAt, 5);

    const res = await reactivate.execute('org-1', a.code, ahora);

    expect(res.map((r) => r.pluginCode).sort()).toEqual(['mod.a', 'mod.b', 'mod.c']);
    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows.every((r) => r.status === 'active' && r.deactivatedAt === null)).toBe(true);
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.activatedAt).toEqual(original.activatedAt);
    expect(uow.repos.events.filter((e) => e.type === 'plugin.activated' && (e.payload as { reactivated?: boolean }).reactivated)).toHaveLength(3);
    expect(await uow.repos.discountRedemptions.listByOrganization('org-1')).toHaveLength(0);
  });

  it('si ya terminó lo pagado, NO es gratis: hay que comprarlo de nuevo (carrito)', async () => {
    const { uow, a, activate, deactivate, reactivate, original } = await mundo();
    await deactivate.execute('org-1', a.code, diasDespues(original.activatedAt, 3));
    const fin = addMonths(original.activatedAt, 1);
    await new ApplyDueDeactivationsUseCase(uow, uow.repos.organizationPlugins, uow.repos.plugins, deactivate).execute(fin);

    await expect(reactivate.execute('org-1', a.code, diasDespues(fin, 1))).rejects.toBeInstanceOf(ReactivationNotFreeError);

    // y por el carrito sí se puede, como compra nueva
    await activate.executeMany('org-1', [a.code]);
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('active');
  });

  it('la baja programada que se cumple queda fechada en la fecha programada, no cuando corrió el barrido', async () => {
    const { uow, a, deactivate, original } = await mundo();
    await deactivate.execute('org-1', a.code, diasDespues(original.activatedAt, 3));
    const fin = addMonths(original.activatedAt, 1);

    await new ApplyDueDeactivationsUseCase(uow, uow.repos.organizationPlugins, uow.repos.plugins, deactivate)
      .execute(new Date(fin.getTime() + 5 * 60_000));

    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.deactivatedAt).toEqual(fin);
  });

  it('si algo que necesita ya no está pagado, no se puede reactivar gratis', async () => {
    const { uow, a, b, deactivate, reactivate, original } = await mundo();
    await deactivate.applyNow('org-1', a.code);
    // la dependencia b se había desactivado hace mucho: ya no está pagada
    const viejo = new Date(original.activatedAt.getTime() - 400 * 86_400_000);
    await uow.repos.organizationPlugins.save(
      OrganizationPlugin.fromPersistence({
        organizationId: 'org-1', pluginId: b.id, activationSource: 'dependency', requiredByPluginId: a.id, status: 'disabled',
        activatedAt: viejo, deactivatedAt: new Date(viejo.getTime() + 5 * 86_400_000), deactivateAt: null,
      }),
    );

    await expect(reactivate.execute('org-1', a.code, diasDespues(original.activatedAt, 5))).rejects.toBeInstanceOf(ReactivationNotFreeError);
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('disabled');
  });

  it('un módulo que ya está activo no se reactiva', async () => {
    const { a, reactivate } = await mundo();
    await expect(reactivate.execute('org-1', a.code)).rejects.toBeInstanceOf(PluginAlreadyActiveError);
  });

  it('el listado dice hasta cuándo es gratis reactivar, o nada si ya no', async () => {
    const { uow, a, deactivate, original } = await mundo();
    const lista = new GetOrganizationPluginsUseCase(
      uow.repos.organizationPlugins, uow.repos.plugins, uow.repos.translations, uow.repos.organizationTrials,
    );
    await deactivate.applyNow('org-1', a.code);

    const dentro = (await lista.execute('org-1', 'es', diasDespues(original.activatedAt, 5))).find((r) => r.pluginCode === a.code)!;
    expect(dentro.reactivableUntil).toEqual(addMonths(original.activatedAt, 1));

    const fuera = (await lista.execute('org-1', 'es', diasDespues(original.activatedAt, 40))).find((r) => r.pluginCode === a.code)!;
    expect(fuera.reactivableUntil).toBeNull();
  });

  it('durante la prueba gratis: lo desactivado se puede reactivar sin costo hasta que la prueba termine', async () => {
    const { uow, a, deactivate, reactivate, original } = await mundo();
    const trial = OrganizationTrial.start({ organizationId: 'org-1', userId: 'u', months: 3, now: original.activatedAt });
    await uow.repos.organizationTrials.insertIfAbsent(trial);
    await deactivate.applyNow('org-1', a.code);

    await reactivate.execute('org-1', a.code, diasDespues(original.activatedAt, 60));

    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('active');
  });
});
