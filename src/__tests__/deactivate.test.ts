import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { ApplyDueDeactivationsUseCase } from '../application/use-cases/apply-due-deactivations';
import { CancelPluginDeactivationUseCase } from '../application/use-cases/cancel-plugin-deactivation';
import { DeactivatePluginUseCase } from '../application/use-cases/deactivate-plugin';
import { GetOrganizationPluginsUseCase } from '../application/use-cases/get-organization-plugins';
import { currentPeriodEnd } from '../domain/billing-period';
import { BlockingDependentsError, PluginNotFoundError } from '../domain/errors';
import { OrganizationPlugin } from '../domain/entities';
import { addMonths, OrganizationTrial } from '../domain/trial';
import { createInMemoryUow, createPlugin, seedExampleWorld } from './helpers';

const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);
const diasDespues = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

function barrido(uow: ReturnType<typeof createInMemoryUow>) {
  return new ApplyDueDeactivationsUseCase(
    uow,
    uow.repos.organizationPlugins,
    uow.repos.plugins,
    new DeactivatePluginUseCase(uow),
  );
}

describe('DeactivatePluginUseCase', () => {
  it('intentar desactivar B mientras A sigue activo → BlockingDependentsError', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const useCase = new DeactivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', b.code)).rejects.toThrow(BlockingDependentsError);
    const bRow = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(bRow?.status).toBe('active');
  });

  it('desactivar A con B y C activados como dependency (cadena A→B→C) → todos se desactivan', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const useCase = new DeactivatePluginUseCase(uow);
    const result = await useCase.applyNow('org-1', a.code);

    expect(result.map((r) => r.pluginCode).sort()).toEqual(['mod.a', 'mod.b', 'mod.c']);
    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows.every((r) => r.status === 'disabled')).toBe(true);

    const deactivatedEvents = uow.repos.events.filter((e) => e.type === 'plugin.deactivated');
    expect(deactivatedEvents).toHaveLength(3);
  });

  it('desactivar A cuando B fue activado direct → B permanece activo', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    await uow.repos.organizationPlugins.save(OrganizationPlugin.activateDirect('org-1', b.id));
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const result = await new DeactivatePluginUseCase(uow).applyNow('org-1', a.code);

    expect(result).toHaveLength(1);
    expect(result[0].pluginCode).toBe('mod.a');
    const bRow = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(bRow?.status).toBe('active');
  });

  it('desactivar un plugin que la organización no tiene activo → PluginNotFoundError', async () => {
    const uow = createInMemoryUow();
    seedExampleWorld(uow.repos);
    const useCase = new DeactivatePluginUseCase(uow);

    await expect(useCase.execute('org-1', 'mod.a')).rejects.toThrow(PluginNotFoundError);
  });

  it('un módulo desactivado se puede reactivar, con sus dependencias, y vuelve a figurar como activo', async () => {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);
    await new DeactivatePluginUseCase(uow).applyNow('org-1', a.code);

    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'active' && r.deactivatedAt === null)).toBe(true);
  });
});

describe('periodo pago de un módulo', () => {
  it('sin prueba: el periodo termina un mes después de la activación, y luego cada mes desde la misma fecha', () => {
    const activatedAt = dia('2026-01-31');
    expect(currentPeriodEnd({ activatedAt, trialEndsAt: null, now: dia('2026-02-10') })).toEqual(dia('2026-02-28'));
    expect(currentPeriodEnd({ activatedAt, trialEndsAt: null, now: dia('2026-03-01') })).toEqual(dia('2026-03-31'));
  });

  it('en el instante exacto en que termina un periodo ya empieza el siguiente', () => {
    const activatedAt = dia('2026-10-08');
    expect(currentPeriodEnd({ activatedAt, trialEndsAt: null, now: dia('2026-11-08') })).toEqual(dia('2026-12-08'));
  });

  it('durante la prueba el periodo es la propia prueba; después, meses contados desde que termina', () => {
    const activatedAt = dia('2026-10-08');
    const trialEndsAt = dia('2027-01-08');
    expect(currentPeriodEnd({ activatedAt, trialEndsAt, now: dia('2026-11-20') })).toEqual(trialEndsAt);
    expect(currentPeriodEnd({ activatedAt, trialEndsAt, now: dia('2027-01-20') })).toEqual(dia('2027-02-08'));
  });

  it('un módulo activado después de la prueba cuenta desde su propia activación', () => {
    const activatedAt = dia('2027-02-15');
    const trialEndsAt = dia('2027-01-08');
    expect(currentPeriodEnd({ activatedAt, trialEndsAt, now: dia('2027-02-20') })).toEqual(dia('2027-03-15'));
  });
});

describe('desactivación «suave» (se respeta lo ya pagado)', () => {
  async function conA() {
    const uow = createInMemoryUow();
    const { a } = seedExampleWorld(uow.repos);
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);
    const row = (await uow.repos.organizationPlugins.find('org-1', a.id))!;
    return { uow, a, row };
  }

  it('pedir la baja deja el módulo ACTIVO hasta el fin del periodo y publica el aviso', async () => {
    const { uow, a, row } = await conA();
    const now = diasDespues(row.activatedAt, 10);

    const [res] = await new DeactivatePluginUseCase(uow).execute('org-1', a.code, now);

    expect(res.status).toBe('active');
    expect(res.deactivateAt).toEqual(addMonths(row.activatedAt, 1));
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('active');
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivated')).toHaveLength(0);
    expect(uow.repos.events.find((e) => e.type === 'plugin.deactivation_scheduled')?.payload).toMatchObject({
      organizationId: 'org-1',
      code: 'mod.a',
      deactivateAt: addMonths(row.activatedAt, 1),
    });
  });

  it('pedirla dos veces no mueve la fecha ni repite el aviso', async () => {
    const { uow, a, row } = await conA();
    const useCase = new DeactivatePluginUseCase(uow);
    const primera = await useCase.execute('org-1', a.code, diasDespues(row.activatedAt, 1));
    const segunda = await useCase.execute('org-1', a.code, diasDespues(row.activatedAt, 25));

    expect(segunda[0].deactivateAt).toEqual(primera[0].deactivateAt);
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivation_scheduled')).toHaveLength(1);
  });

  it('durante la prueba gratis queda activo hasta que la prueba termina', async () => {
    const { uow, a, row } = await conA();
    const trial = OrganizationTrial.start({ organizationId: 'org-1', userId: 'u', months: 3, now: row.activatedAt });
    await uow.repos.organizationTrials.insertIfAbsent(trial);

    const [res] = await new DeactivatePluginUseCase(uow).execute('org-1', a.code, diasDespues(row.activatedAt, 5));

    expect(res.deactivateAt).toEqual(trial.endsAt);
  });

  it('un módulo gratis no tiene nada pago que esperar: se apaga en el acto', async () => {
    const uow = createInMemoryUow();
    const libre = createPlugin({ code: 'free.x', name: 'Libre', priceCents: 0 });
    await uow.repos.plugins.save(libre);
    await new ActivatePluginUseCase(uow).execute('org-1', libre.code);

    const [res] = await new DeactivatePluginUseCase(uow).execute('org-1', libre.code);

    expect(res.status).toBe('disabled');
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivated')).toHaveLength(1);
  });

  it('el barrido NO apaga antes de la fecha y SÍ después, con su cascada y su evento', async () => {
    const { uow, a, row } = await conA();
    await new DeactivatePluginUseCase(uow).execute('org-1', a.code, diasDespues(row.activatedAt, 3));
    const fin = addMonths(row.activatedAt, 1);

    expect(await barrido(uow).execute(diasDespues(fin, -1))).toBe(0);
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('active');

    expect(await barrido(uow).execute(fin)).toBe(3); // A y las dos que se activaron por ella
    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows.every((r) => r.status === 'disabled' && r.deactivateAt === null)).toBe(true);
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivated')).toHaveLength(3);

    expect(await barrido(uow).execute(diasDespues(fin, 1))).toBe(0); // idempotente
  });

  it('arrepentirse antes de la fecha: sigue activo, sin cobro nuevo, y el barrido ya no lo toca', async () => {
    const { uow, a, row } = await conA();
    await new DeactivatePluginUseCase(uow).execute('org-1', a.code, diasDespues(row.activatedAt, 3));

    const res = await new CancelPluginDeactivationUseCase(uow).execute('org-1', a.code);

    expect(res.deactivateAt).toBeNull();
    expect(res.status).toBe('active');
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivation_cancelled')).toHaveLength(1);
    expect(await barrido(uow).execute(addMonths(row.activatedAt, 2))).toBe(0);
    expect((await uow.repos.organizationPlugins.find('org-1', a.id))?.status).toBe('active');
  });

  it('cancelar lo que no estaba programado no hace nada ni ensucia la bitácora', async () => {
    const { uow, a } = await conA();
    await new CancelPluginDeactivationUseCase(uow).execute('org-1', a.code);
    expect(uow.repos.events.filter((e) => e.type === 'plugin.deactivation_cancelled')).toHaveLength(0);
  });

  it('si al llegar la fecha algo activo ya depende de él, la baja se cancela (no se rompe a nadie)', async () => {
    const uow = createInMemoryUow();
    const { a, b } = seedExampleWorld(uow.repos);
    // B contratado directo y programado para baja; luego se activa A, que lo necesita.
    await uow.repos.organizationPlugins.save(OrganizationPlugin.activateDirect('org-1', b.id));
    const row = (await uow.repos.organizationPlugins.find('org-1', b.id))!;
    await new DeactivatePluginUseCase(uow).execute('org-1', b.code, diasDespues(row.activatedAt, 2));
    await new ActivatePluginUseCase(uow).execute('org-1', a.code);

    expect(await barrido(uow).execute(addMonths(row.activatedAt, 2))).toBe(0);

    const despues = await uow.repos.organizationPlugins.find('org-1', b.id);
    expect(despues?.status).toBe('active');
    expect(despues?.deactivateAt).toBeNull();
    expect(uow.repos.events.find((e) => e.type === 'plugin.deactivation_cancelled')?.payload).toMatchObject({ reason: 'dependents' });
  });

  it('el listado informa la baja programada y cuándo termina el periodo pago', async () => {
    const { uow, a, row } = await conA();
    const lista = new GetOrganizationPluginsUseCase(
      uow.repos.organizationPlugins,
      uow.repos.plugins,
      uow.repos.translations,
      uow.repos.organizationTrials,
    );
    const now = diasDespues(row.activatedAt, 4);

    const antes = (await lista.execute('org-1', 'es', now)).find((r) => r.pluginCode === a.code)!;
    expect(antes.deactivateAt).toBeNull();
    expect(antes.periodEndsAt).toEqual(addMonths(row.activatedAt, 1));

    await new DeactivatePluginUseCase(uow).execute('org-1', a.code, now);
    const despues = (await lista.execute('org-1', 'es', now)).find((r) => r.pluginCode === a.code)!;
    expect(despues.deactivateAt).toEqual(addMonths(row.activatedAt, 1));
  });
});
