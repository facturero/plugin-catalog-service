import { describe, expect, it } from 'vitest';
import { addMonths, OrganizationTrial } from '../domain/trial';
import { GetSubscriptionUseCase } from '../application/use-cases/get-subscription';
import { QuoteActivationUseCase } from '../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { CreateDiscountUseCase } from '../application/use-cases/manage-discounts';
import { PricingPolicy, vatCents } from '../application/pricing-policy';
import { createInMemoryUow, seedExampleWorld } from './helpers';

const politica: PricingPolicy = { trialMonths: 3, vatBps: 1500 };
const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

function mundo(policy: PricingPolicy = politica) {
  const uow = createInMemoryUow();
  const world = seedExampleWorld(uow.repos);
  const subscription = new GetSubscriptionUseCase(uow, policy);
  const quote = new QuoteActivationUseCase(
    uow.repos.plugins,
    uow.repos.dependencies,
    uow.repos.organizationPlugins,
    uow.repos.translations,
    uow.repos.discounts,
    uow.repos.discountRedemptions,
    uow.repos.organizationTrials,
    policy,
  );
  return { uow, ...world, subscription, quote };
}

const admin = { organizationId: 'org-1', userId: 'admin-1', canManagePlugins: true };

describe('meses de calendario', () => {
  it('31 de enero + 1 mes es fin de febrero, nunca marzo', () => {
    expect(addMonths(dia('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(dia('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('tres meses desde el 8 de octubre terminan el 8 de enero', () => {
    expect(addMonths(dia('2026-10-08'), 3).toISOString().slice(0, 10)).toBe('2027-01-08');
  });

  it('cruza el fin de año', () => {
    expect(addMonths(dia('2026-11-30'), 3).toISOString().slice(0, 10)).toBe('2027-02-28');
  });
});

describe('la prueba gratis de la organización', () => {
  it('está activa durante los 3 meses y se acaba después', () => {
    const t = OrganizationTrial.start({ organizationId: 'o', userId: 'u', months: 3, now: dia('2026-10-08') });
    expect(t.isActiveAt(dia('2026-10-08'))).toBe(true);
    expect(t.isActiveAt(dia('2026-12-31'))).toBe(true);
    expect(t.isActiveAt(dia('2027-01-08'))).toBe(false);
    expect(t.daysLeftAt(dia('2027-01-07'))).toBe(1);
    expect(t.daysLeftAt(dia('2027-02-01'))).toBe(0);
  });

  it('con 0 meses no hay prueba', () => {
    const t = OrganizationTrial.start({ organizationId: 'o', userId: 'u', months: 0, now: dia('2026-10-08') });
    expect(t.isActiveAt(dia('2026-10-08'))).toBe(false);
  });
});

describe('arrancar la prueba (primer ingreso del administrador)', () => {
  it('el administrador la arranca una sola vez y se publica pricing.trial.started', async () => {
    const { uow, subscription } = mundo();
    const primero = await subscription.execute({ ...admin, now: dia('2026-10-08') });
    const segundo = await subscription.execute({ ...admin, now: dia('2026-11-20') });

    expect(primero.trial).toMatchObject({ active: true });
    expect(primero.trial?.started_at.slice(0, 10)).toBe('2026-10-08');
    expect(primero.trial?.ends_at.slice(0, 10)).toBe('2027-01-08');
    // Volver a entrar NO reinicia ni alarga la prueba.
    expect(segundo.trial?.started_at).toBe(primero.trial?.started_at);
    expect(segundo.trial?.ends_at).toBe(primero.trial?.ends_at);
    expect(uow.repos.events.filter((e) => e.type === 'pricing.trial.started')).toHaveLength(1);
    expect(uow.repos.events.find((e) => e.type === 'pricing.trial.started')?.payload).toMatchObject({
      organizationId: 'org-1',
      months: 3,
    });
  });

  it('alguien SIN permiso de gestionar módulos solo lee: no arranca la prueba de la organización', async () => {
    const { uow, subscription } = mundo();
    const vendedor = await subscription.execute({ organizationId: 'org-1', userId: 'vendedor', canManagePlugins: false });
    expect(vendedor.trial).toBeNull();
    expect(uow.repos.events.filter((e) => e.type === 'pricing.trial.started')).toHaveLength(0);

    // Cuando el administrador ingresa, sí arranca, y desde ese momento todos la ven.
    await subscription.execute(admin);
    const despues = await subscription.execute({ organizationId: 'org-1', userId: 'vendedor', canManagePlugins: false });
    expect(despues.trial).not.toBeNull();
  });

  it('cada organización tiene su propia prueba', async () => {
    const { subscription } = mundo();
    const a = await subscription.execute({ ...admin, now: dia('2026-10-08') });
    const b = await subscription.execute({ organizationId: 'org-2', userId: 'admin-2', canManagePlugins: true, now: dia('2026-12-01') });
    expect(a.trial?.ends_at.slice(0, 10)).toBe('2027-01-08');
    expect(b.trial?.ends_at.slice(0, 10)).toBe('2027-03-01');
  });

  it('dos ingresos a la vez del administrador crean una sola prueba y un solo evento', async () => {
    const { uow, subscription } = mundo();
    await Promise.all([subscription.execute(admin), subscription.execute(admin), subscription.execute(admin)]);
    expect(uow.repos.events.filter((e) => e.type === 'pricing.trial.started')).toHaveLength(1);
  });

  it('con TRIAL_MONTHS=0 no hay prueba', async () => {
    const { subscription } = mundo({ trialMonths: 0, vatBps: 1500 });
    expect((await subscription.execute(admin)).trial).toBeNull();
  });

  it('informa el IVA para que la pantalla no lo invente', async () => {
    const { subscription } = mundo();
    expect((await subscription.execute(admin)).vat_percent).toBe(15);
  });
});

describe('IVA', () => {
  it('se redondea al centavo y se calcula sobre el total', () => {
    expect(vatCents(3500, 1500)).toBe(525);
    expect(vatCents(999, 1500)).toBe(150); // 149,85
    expect(vatCents(0, 1500)).toBe(0);
    expect(vatCents(1000, 0)).toBe(0);
  });
});

describe('cotización con prueba, IVA y descuento', () => {
  it('antes de que el administrador ingrese: precio de lista, IVA y se pagaría ya', async () => {
    const { a, quote } = mundo();
    const q = await quote.execute('org-1', a.code);
    expect(q).toMatchObject({ total_monthly: 3500, vat_percent: 15, vat_cents: 525, total_with_vat: 4025, due_today: 4025 });
    expect(q.trial).toBeUndefined();
  });

  it('con la prueba activa se paga 0 hoy, pero se muestra lo que costará después', async () => {
    const { a, subscription, quote } = mundo();
    await subscription.execute(admin);

    const q = await quote.execute('org-1', a.code);

    expect(q.trial).toMatchObject({ active: true });
    expect(q.due_today).toBe(0);
    expect(q.total_with_vat).toBe(4025);
  });

  it('con la prueba vencida vuelve a pagarse', async () => {
    const { uow, a, quote } = mundo();
    await uow.repos.organizationTrials.insertIfAbsent(
      OrganizationTrial.start({ organizationId: 'org-1', userId: 'admin-1', months: 3, now: dia('2025-01-01') }),
    );
    const q = await quote.execute('org-1', a.code);
    expect(q.trial?.active).toBe(false);
    expect(q.due_today).toBe(4025);
  });

  it('el IVA se calcula sobre el total YA descontado', async () => {
    const { uow, a, quote } = mundo();
    await new CreateDiscountUseCase(uow).execute({ code: 'VEINTE', name: '20 %', kind: 'percent', value: 2000 });
    const q = await quote.execute('org-1', a.code, 'es', 'VEINTE');
    // 35,00 - 20 % = 28,00; IVA 15 % = 4,20; total 32,20
    expect(q).toMatchObject({ total_after_discount: 2800, vat_cents: 420, total_with_vat: 3220 });
  });

  it('el descuento por módulo de monto fijo baja cada módulo', async () => {
    const { uow, a, quote } = mundo();
    await new CreateDiscountUseCase(uow).execute({ code: 'DOSPORMODULO', name: '2 por módulo', kind: 'fixed', value: 200 });
    const q = await quote.execute('org-1', a.code, 'es', 'DOSPORMODULO');
    // a=20,00 b=10,00 c=5,00 → cada uno 2,00 menos = 6,00 en total
    expect(q.discount?.discount_cents).toBe(600);
    expect(q.total_after_discount).toBe(2900);
  });
});

describe('el descuento no se gasta durante la prueba', () => {
  it('con la prueba activa, la duración del descuento cuenta desde que termina la prueba', async () => {
    const { uow, c, subscription } = mundo();
    await subscription.execute(admin);
    const trial = (await uow.repos.organizationTrials.find('org-1'))!;
    await new CreateDiscountUseCase(uow).execute({ code: 'SEISMESES', name: '6 meses', kind: 'percent', value: 5000, durationMonths: 6 });

    await new ActivatePluginUseCase(uow).execute('org-1', c.code, { discountCode: 'SEISMESES' });

    const [canje] = await uow.repos.discountRedemptions.listByOrganization('org-1');
    expect(canje.expiresAt?.toISOString().slice(0, 10)).toBe(addMonths(trial.endsAt, 6).toISOString().slice(0, 10));
    const ev = uow.repos.events.find((e) => e.type === 'pricing.discount.redeemed');
    expect(ev?.payload.startsAt).toEqual(trial.endsAt);
  });

  it('sin prueba activa, cuenta desde hoy', async () => {
    const { uow, c } = mundo();
    await new CreateDiscountUseCase(uow).execute({ code: 'SEISMESES', name: '6 meses', kind: 'percent', value: 5000, durationMonths: 6 });
    const antes = Date.now();

    await new ActivatePluginUseCase(uow).execute('org-1', c.code, { discountCode: 'SEISMESES' });

    const [canje] = await uow.repos.discountRedemptions.listByOrganization('org-1');
    const esperado = addMonths(new Date(antes), 6).getTime();
    expect(Math.abs((canje.expiresAt?.getTime() ?? 0) - esperado)).toBeLessThan(5000);
  });
});
