import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { QuoteActivationUseCase } from '../application/use-cases/quote-activation';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from '../application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from '../application/use-cases/list-my-discount-redemptions';
import { OrganizationPlugin } from '../domain/entities';
import { DiscountCodeAlreadyExistsError, DiscountNotFoundError, DiscountRejectedError, ValidationError } from '../domain/errors';
import { createInMemoryUow, seedExampleWorld } from './helpers';

/** El mundo de los tests: A cuesta 20,00 y arrastra B (10,00) y C (5,00): 35,00 en total. */
function mundo() {
  const uow = createInMemoryUow();
  const world = seedExampleWorld(uow.repos);
  const create = new CreateDiscountUseCase(uow);
  const quote = new QuoteActivationUseCase(
    uow.repos.plugins,
    uow.repos.dependencies,
    uow.repos.organizationPlugins,
    uow.repos.translations,
    uow.repos.discounts,
    uow.repos.discountRedemptions,
  );
  const activate = new ActivatePluginUseCase(uow);
  return { uow, ...world, create, quote, activate };
}

const eventosDe = (uow: ReturnType<typeof mundo>['uow'], type: string) => uow.repos.events.filter((e) => e.type === type);

describe('Administrar descuentos', () => {
  it('crear un descuento porcentual: queda guardado y publica pricing.discount.created', async () => {
    const { uow, create } = mundo();
    const dto = await create.execute({ code: 'lanzamiento', name: 'Lanzamiento', kind: 'percent', value: 2000, createdByUserId: 'admin-1' });

    expect(dto).toMatchObject({ code: 'LANZAMIENTO', kind: 'percent', value: 2000, percent: 20, amountCents: null, isActive: true, redemptionCount: 0 });
    const ev = eventosDe(uow, 'pricing.discount.created')[0];
    expect(ev.payload).toMatchObject({ targetId: dto.id, code: 'LANZAMIENTO', kind: 'percent', value: 2000 });
    // Evento de plataforma: sin organización, y con prefijo pricing. (el gateway recarga módulos con cada plugin.*).
    expect(ev.payload).not.toHaveProperty('organizationId');
    expect(ev.type.startsWith('plugin.')).toBe(false);
  });

  it('el código no se repite, sin importar mayúsculas', async () => {
    const { create } = mundo();
    await create.execute({ code: 'BIENVENIDA', name: 'Bienvenida', kind: 'percent', value: 1000 });
    await expect(create.execute({ code: 'bienvenida', name: 'Otra', kind: 'fixed', value: 100 })).rejects.toBeInstanceOf(
      DiscountCodeAlreadyExistsError,
    );
  });

  it('un módulo que no existe en el alcance se rechaza (si no, el descuento nunca aplicaría y nadie sabría por qué)', async () => {
    const { uow, create } = mundo();
    await expect(
      create.execute({ code: 'RARO', name: 'Raro', kind: 'percent', value: 1000, pluginCodes: ['mod.a', 'mod.no-existe'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(eventosDe(uow, 'pricing.discount.created')).toHaveLength(0);
  });

  it('modificar publica pricing.discount.updated con lo anterior; el valor y el código no se tocan', async () => {
    const { uow, create } = mundo();
    const d = await create.execute({ code: 'AGO', name: 'Agosto', kind: 'percent', value: 1000, maxRedemptions: 10 });
    const updated = await new UpdateDiscountUseCase(uow).execute({ id: d.id, name: 'Agosto 2026', maxRedemptions: 50 });

    expect(updated).toMatchObject({ name: 'Agosto 2026', maxRedemptions: 50, code: 'AGO', value: 1000 });
    const ev = eventosDe(uow, 'pricing.discount.updated')[0];
    expect(ev.payload).toMatchObject({ targetId: d.id, previous: { name: 'Agosto', maxRedemptions: 10 } });
  });

  it('desactivar y reactivar publican su evento; repetir el mismo estado no ensucia la bitácora', async () => {
    const { uow, create } = mundo();
    const d = await create.execute({ code: 'TEMP', name: 'Temporal', kind: 'percent', value: 500 });
    const set = new SetDiscountActiveUseCase(uow);

    await set.execute(d.id, false);
    await set.execute(d.id, false);
    await set.execute(d.id, true);

    expect(eventosDe(uow, 'pricing.discount.deactivated')).toHaveLength(1);
    expect(eventosDe(uow, 'pricing.discount.reactivated')).toHaveLength(1);
    await expect(set.execute('no-existe', false)).rejects.toBeInstanceOf(DiscountNotFoundError);
  });

  it('listar devuelve lo creado', async () => {
    const { uow, create } = mundo();
    await create.execute({ code: 'UNO', name: 'Uno', kind: 'percent', value: 100 });
    await create.execute({ code: 'DOS', name: 'Dos', kind: 'fixed', value: 250 });
    const lista = await new ListDiscountsUseCase(uow).execute();
    expect(lista.map((x) => x.code).sort()).toEqual(['DOS', 'UNO']);
  });
});

describe('Cotizar con un código', () => {
  it('sin código, la cotización es la de siempre (sin campos nuevos)', async () => {
    const { a, quote } = mundo();
    const q = await quote.execute('org-1', a.code);
    expect(q.total_monthly).toBe(3500);
    expect(q).not.toHaveProperty('discount');
    expect(q).not.toHaveProperty('discount_error');
    expect(q).not.toHaveProperty('total_after_discount');
  });

  it('con un 20 %: descuenta el módulo y lo que arrastra, línea por línea', async () => {
    const { a, create, quote } = mundo();
    await create.execute({ code: 'VEINTE', name: '20 por ciento', kind: 'percent', value: 2000 });

    const q = await quote.execute('org-1', a.code, 'es', 'veinte');

    expect(q.total_monthly).toBe(3500);
    expect(q.discount?.discount_cents).toBe(700);
    expect(q.total_after_discount).toBe(2800);
    expect(q.discount?.lines.reduce((s, l) => s + l.discount, 0)).toBe(700);
  });

  it('lo que ya está activo no se cobra, así que no se descuenta', async () => {
    const { uow, a, b, create, quote } = mundo();
    await uow.repos.organizationPlugins.save(OrganizationPlugin.activateDirect('org-1', b.id));
    await create.execute({ code: 'VEINTE', name: '20 por ciento', kind: 'percent', value: 2000 });

    const q = await quote.execute('org-1', a.code, 'es', 'VEINTE');

    // A (20,00) + C (5,00); B ya estaba. 20 % de 25,00 = 5,00.
    expect(q.total_monthly).toBe(2500);
    expect(q.discount?.discount_cents).toBe(500);
    expect(q.discount?.lines.map((l) => l.plugin_code)).not.toContain('mod.b');
  });

  it.each([
    ['un código que no existe', 'NOEXISTE', 'DISCOUNT_NOT_FOUND'],
  ])('%s: cotiza normal y explica por qué no aplica', async (_nombre, codigo, esperado) => {
    const { a, quote } = mundo();
    const q = await quote.execute('org-1', a.code, 'es', codigo);
    expect(q.total_monthly).toBe(3500);
    expect(q.discount).toBeUndefined();
    expect(q.discount_error?.code).toBe(esperado);
  });

  it('un código vencido o desactivado se explica, no se aplica', async () => {
    const { uow, a, create, quote } = mundo();
    const vencido = await create.execute({ code: 'VIEJO', name: 'Viejo', kind: 'percent', value: 1000, validFrom: new Date('2020-01-01'), validUntil: new Date('2020-12-31') });
    expect((await quote.execute('org-1', a.code, 'es', 'VIEJO')).discount_error?.code).toBe('DISCOUNT_EXPIRED');

    const otro = await create.execute({ code: 'APAGADO', name: 'Apagado', kind: 'percent', value: 1000 });
    await new SetDiscountActiveUseCase(uow).execute(otro.id, false);
    expect((await quote.execute('org-1', a.code, 'es', 'APAGADO')).discount_error?.code).toBe('DISCOUNT_INACTIVE');
    expect(vencido.isActive).toBe(true);
  });

  it('un código privado de otra organización responde igual que uno que no existe', async () => {
    const { a, create, quote } = mundo();
    await create.execute({ code: 'PRIVADO', name: 'Privado', kind: 'percent', value: 5000, organizationId: '11111111-1111-4111-8111-111111111111' });
    const q = await quote.execute('org-1', a.code, 'es', 'PRIVADO');
    expect(q.discount_error?.code).toBe('DISCOUNT_NOT_FOUND');
  });

  it('cotizar NO gasta el código: el canje solo ocurre al activar', async () => {
    const { uow, a, create, quote } = mundo();
    const d = await create.execute({ code: 'UNAVEZ', name: 'Una vez', kind: 'percent', value: 1000, maxRedemptions: 1 });
    await quote.execute('org-1', a.code, 'es', 'UNAVEZ');
    await quote.execute('org-1', a.code, 'es', 'UNAVEZ');
    expect((await uow.repos.discounts.findById(d.id))?.redemptionCount).toBe(0);
  });
});

describe('Activar con un código', () => {
  it('activa, registra el canje con lo que se prometió pagar y publica pricing.discount.redeemed', async () => {
    const { uow, a, create, activate } = mundo();
    const d = await create.execute({ code: 'VEINTE', name: '20 por ciento', kind: 'percent', value: 2000, durationMonths: 6 });

    const activados = await activate.execute('org-1', a.code, { discountCode: 'veinte', userId: 'user-9' });

    expect(activados).toHaveLength(3);
    const [canje] = await uow.repos.discountRedemptions.listByOrganization('org-1');
    expect(canje).toMatchObject({
      discountId: d.id,
      organizationId: 'org-1',
      pluginCode: 'mod.a',
      redeemedByUserId: 'user-9',
      listCents: 3500,
      discountCents: 700,
      finalCents: 2800,
    });
    expect(canje.expiresAt).not.toBeNull();
    expect((await uow.repos.discounts.findById(d.id))?.redemptionCount).toBe(1);

    const ev = eventosDe(uow, 'pricing.discount.redeemed')[0];
    expect(ev.payload).toMatchObject({ targetId: d.id, organizationId: 'org-1', discountCode: 'VEINTE', discountCents: 700, finalCents: 2800, durationMonths: 6 });
  });

  it('un código malo NO activa nada: ni módulos ni canje', async () => {
    const { uow, a, activate } = mundo();
    await expect(activate.execute('org-1', a.code, { discountCode: 'NOEXISTE' })).rejects.toBeInstanceOf(DiscountNotFoundError);
    expect(await uow.repos.organizationPlugins.listByOrganization('org-1')).toHaveLength(0);
    expect(eventosDe(uow, 'plugin.activated')).toHaveLength(0);
  });

  it('el tope por organización: el mismo código no se usa dos veces', async () => {
    const { uow, a, c, create, activate } = mundo();
    await create.execute({ code: 'UNAVEZ', name: 'Una vez', kind: 'percent', value: 1000 });
    await activate.execute('org-1', c.code, { discountCode: 'UNAVEZ' });

    await expect(activate.execute('org-1', a.code, { discountCode: 'UNAVEZ' })).rejects.toBeInstanceOf(DiscountRejectedError);
    // A no se activó por el intento fallido.
    const activos = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(activos.map((o) => o.pluginId)).toEqual([c.id]);
  });

  it('el tope global: cuando se agota, otra organización ya no puede', async () => {
    const { a, c, create, activate } = mundo();
    await create.execute({ code: 'SOLOUNO', name: 'Solo uno', kind: 'percent', value: 1000, maxRedemptions: 1 });
    await activate.execute('org-1', c.code, { discountCode: 'SOLOUNO' });

    await expect(activate.execute('org-2', a.code, { discountCode: 'SOLOUNO' })).rejects.toMatchObject({
      code: 'DISCOUNT_EXHAUSTED',
    });
  });

  it('activar sin código sigue funcionando y no deja canje', async () => {
    const { uow, c, activate } = mundo();
    await activate.execute('org-1', c.code);
    expect(await uow.repos.discountRedemptions.listByOrganization('org-1')).toHaveLength(0);
    expect(eventosDe(uow, 'pricing.discount.redeemed')).toHaveLength(0);
  });

  it('«Mis descuentos» muestra el canje con lo prometido', async () => {
    const { uow, c, create, activate } = mundo();
    await create.execute({ code: 'MEDIO', name: 'Medio precio', kind: 'percent', value: 5000, durationMonths: 3 });
    await activate.execute('org-1', c.code, { discountCode: 'MEDIO' });

    const mios = await new ListMyDiscountRedemptionsUseCase(uow.repos.discounts, uow.repos.discountRedemptions).execute('org-1');
    expect(mios).toHaveLength(1);
    expect(mios[0]).toMatchObject({ discountCode: 'MEDIO', pluginCode: 'mod.c', listCents: 500, discountCents: 250, finalCents: 250, active: true });

    const dentroDeUnAno = new Date(Date.now() + 366 * 24 * 3600 * 1000);
    const luego = await new ListMyDiscountRedemptionsUseCase(uow.repos.discounts, uow.repos.discountRedemptions).execute('org-1', dentroDeUnAno);
    expect(luego[0].active).toBe(false);
  });
});
