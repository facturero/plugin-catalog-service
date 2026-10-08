import { describe, expect, it } from 'vitest';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { QuoteActivationUseCase } from '../application/use-cases/quote-activation';
import { CreateDiscountUseCase } from '../application/use-cases/manage-discounts';
import { DEFAULT_PRICING_POLICY } from '../application/pricing-policy';
import { AddToCartUseCase, ClearCartUseCase, GetCartUseCase, RemoveFromCartUseCase } from '../application/use-cases/cart';
import { PluginDependency } from '../domain/entities';
import {
  CorePluginNotConfigurableError,
  DiscountRejectedError,
  MissingDependenciesError,
  PluginAlreadyActiveError,
  PluginNotAvailableError,
  PluginNotFoundError,
  ValidationError,
} from '../domain/errors';
import { createInMemoryUow, createPlugin, seedExampleWorld } from './helpers';

/**
 * Mundo del carrito: a (20,00) → b (10,00) → c (5,00), más d (3,00) que también necesita b, y e (7,00) sin dependencias.
 * a y d comparten b y c: en el carrito se cuentan UNA vez.
 */
async function mundo() {
  const uow = createInMemoryUow();
  const { a, b, c } = seedExampleWorld(uow.repos);
  const d = createPlugin({ code: 'mod.d', name: 'Plugin D', priceCents: 300 });
  const e = createPlugin({ code: 'mod.e', name: 'Plugin E', priceCents: 700 });
  await uow.repos.plugins.save(d);
  await uow.repos.plugins.save(e);
  const internal = (uow.repos as unknown as {
    __internals: { deps: Map<string, PluginDependency>; depKey: (x: string, y: string) => string };
  }).__internals;
  internal.deps.set(internal.depKey(d.id, b.id), PluginDependency.create({ pluginId: d.id, dependsOnPluginId: b.id }));

  const r = uow.repos;
  const quote = new QuoteActivationUseCase(
    r.plugins, r.dependencies, r.organizationPlugins, r.translations, r.discounts, r.discountRedemptions, r.organizationTrials, DEFAULT_PRICING_POLICY,
  );
  return { uow, a, b, c, d, e, quote, activate: new ActivatePluginUseCase(uow) };
}

describe('cotizar el carrito', () => {
  it('lo que dos módulos comparten se cuenta una sola vez', async () => {
    const { quote, a, d } = await mundo();
    const q = await quote.executeCart('org-1', [a.code, d.code]);

    // a 20,00 + d 3,00 + b 10,00 + c 5,00 (b y c una sola vez)
    expect(q.total_monthly).toBe(3800);
    expect(q.items.filter((i) => i.kind === 'selected').map((i) => i.plugin.code)).toEqual(['mod.a', 'mod.d']);
    expect(q.items.filter((i) => i.kind === 'required').map((i) => i.plugin.code).sort()).toEqual(['mod.b', 'mod.c']);
    expect(q.missing).toEqual([]);
  });

  it('un módulo pedido que además es dependencia de otro se cuenta una vez, como pedido', async () => {
    const { quote, a, b } = await mundo();
    const q = await quote.executeCart('org-1', [a.code, b.code]);

    expect(q.items.map((i) => `${i.kind}:${i.plugin.code}`).sort()).toEqual(['required:mod.c', 'selected:mod.a', 'selected:mod.b']);
    expect(q.total_monthly).toBe(3500);
  });

  it('lo que ya está activo no se cobra, pero se muestra', async () => {
    const { quote, activate, a, e } = await mundo();
    await activate.execute('org-1', a.code);

    const q = await quote.executeCart('org-1', [a.code, e.code]);

    expect(q.items.find((i) => i.plugin.code === 'mod.a')?.kind).toBe('already_active');
    expect(q.total_monthly).toBe(700);
  });

  it('lo que no se puede activar sale aparte y no tumba el resto', async () => {
    const { uow, quote, e } = await mundo();
    await uow.repos.plugins.save(createPlugin({ code: 'core.x', isCore: true }));
    await uow.repos.plugins.save(createPlugin({ code: 'wip.y', buildStatus: 'en_construccion', priceCents: 100 }));

    const q = await quote.executeCart('org-1', [e.code, 'nope.z', 'core.x', 'wip.y']);

    expect(q.invalid).toEqual([
      { code: 'nope.z', reason: 'not_found' },
      { code: 'core.x', reason: 'core' },
      { code: 'wip.y', reason: 'not_available' },
    ]);
    expect(q.total_monthly).toBe(700);
  });

  it('un módulo privado de otra organización se informa como inexistente', async () => {
    const { uow, quote } = await mundo();
    await uow.repos.plugins.save(createPlugin({ code: 'priv.x', createdForOrganizationId: 'org-2', priceCents: 100 }));

    const q = await quote.executeCart('org-1', ['priv.x']);

    expect(q.invalid).toEqual([{ code: 'priv.x', reason: 'not_found' }]);
  });

  it('un código de descuento aplica a TODO el carrito; el IVA va sobre el total ya descontado', async () => {
    const { uow, quote, a, d } = await mundo();
    await new CreateDiscountUseCase(uow).execute({ code: 'DIEZ', name: '10 %', kind: 'percent', value: 1000 });

    const q = await quote.executeCart('org-1', [a.code, d.code], 'es', 'DIEZ');

    expect(q.discount?.discount_cents).toBe(380);
    expect(q.total_after_discount).toBe(3420);
    expect(q.vat_cents).toBe(513);
    expect(q.total_with_vat).toBe(3933);
  });

  it('un código malo no tumba la cotización del carrito', async () => {
    const { quote, e } = await mundo();
    const q = await quote.executeCart('org-1', [e.code], 'es', 'NOEXISTE');
    expect(q.discount_error?.code).toBeDefined();
    expect(q.total_monthly).toBe(700);
  });
});

describe('activar el carrito', () => {
  it('activa todo junto: lo elegido como directo y lo que arrastra como dependencia, una sola vez cada cosa', async () => {
    const { uow, activate, a, d, e } = await mundo();

    const res = await activate.executeMany('org-1', [a.code, d.code, e.code]);

    const rows = await uow.repos.organizationPlugins.listByOrganization('org-1');
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.activationSource === 'direct').map((r) => r.pluginId).sort())
      .toEqual([a.id, d.id, e.id].sort());
    expect(rows.filter((r) => r.activationSource === 'dependency')).toHaveLength(2);
    expect(res).toHaveLength(5);
    expect(uow.repos.events.filter((x) => x.type === 'plugin.activated')).toHaveLength(5);
  });

  it('todo o nada: si uno no se puede activar, no se activa NADA', async () => {
    const { uow, activate, e } = await mundo();
    await uow.repos.plugins.save(createPlugin({ code: 'wip.y', buildStatus: 'en_construccion', priceCents: 100 }));

    await expect(activate.executeMany('org-1', [e.code, 'wip.y'])).rejects.toBeInstanceOf(PluginNotAvailableError);

    expect(await uow.repos.organizationPlugins.listByOrganization('org-1')).toHaveLength(0);
    expect(uow.repos.events).toHaveLength(0);
  });

  it('cada razón de rechazo da el mismo error que activar de a uno', async () => {
    const { uow, activate, e } = await mundo();
    await uow.repos.plugins.save(createPlugin({ code: 'core.x', isCore: true }));

    await expect(activate.executeMany('org-1', ['nope.z'])).rejects.toBeInstanceOf(PluginNotFoundError);
    await expect(activate.executeMany('org-1', [e.code, 'core.x'])).rejects.toBeInstanceOf(CorePluginNotConfigurableError);
    await expect(activate.executeMany('org-1', [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('si todo lo pedido ya estaba activo, lo dice; si solo una parte, activa el resto', async () => {
    const { uow, activate, e, d } = await mundo();
    await activate.execute('org-1', e.code);

    await expect(activate.executeMany('org-1', [e.code])).rejects.toBeInstanceOf(PluginAlreadyActiveError);

    const res = await activate.executeMany('org-1', [e.code, d.code]);
    expect(res.map((r) => r.pluginCode)).toContain('mod.d');
    expect(res.map((r) => r.pluginCode)).not.toContain('mod.e');
    expect((await uow.repos.organizationPlugins.listByOrganization('org-1')).every((r) => r.status === 'active')).toBe(true);
  });

  it('una dependencia que no se activa sola impide activar y no deja nada a medias', async () => {
    const { uow, activate, a, b } = await mundo();
    // b ya no se puede activar solo (en construcción): a lo necesita.
    await uow.repos.plugins.save(createPlugin({ id: b.id, code: b.code, name: b.name, priceCents: 1000, buildStatus: 'en_construccion' }));

    await expect(activate.executeMany('org-1', [a.code])).rejects.toBeInstanceOf(MissingDependenciesError);
    expect(await uow.repos.organizationPlugins.listByOrganization('org-1')).toHaveLength(0);
  });

  it('el descuento se canjea UNA sola vez para todo el carrito y guarda todos los módulos', async () => {
    const { uow, activate, a, e } = await mundo();
    await new CreateDiscountUseCase(uow).execute({ code: 'DIEZ', name: '10 %', kind: 'percent', value: 1000 });

    await activate.executeMany('org-1', [a.code, e.code], { discountCode: 'DIEZ', userId: 'u1' });

    const canjes = await uow.repos.discountRedemptions.listByOrganization('org-1');
    expect(canjes).toHaveLength(1);
    expect(canjes[0].pluginCode).toBe('mod.a,mod.e');
    // a 20,00 + e 7,00 + b 10,00 + c 5,00 = 42,00; 10 % = 4,20
    expect(canjes[0].listCents).toBe(4200);
    expect(canjes[0].discountCents).toBe(420);
    expect(uow.repos.events.filter((x) => x.type === 'pricing.discount.redeemed')).toHaveLength(1);
  });

  it('un código malo impide activar TODO el carrito', async () => {
    const { uow, activate, a, e } = await mundo();
    await expect(activate.executeMany('org-1', [a.code, e.code], { discountCode: 'NOEXISTE' })).rejects.toBeDefined();
    expect(await uow.repos.organizationPlugins.listByOrganization('org-1')).toHaveLength(0);

    await new CreateDiscountUseCase(uow).execute({ code: 'SOLOUNA', name: 'Una vez', kind: 'percent', value: 1000 });
    await activate.executeMany('org-1', [e.code], { discountCode: 'SOLOUNA' });
    await expect(activate.executeMany('org-1', [a.code], { discountCode: 'SOLOUNA' })).rejects.toBeInstanceOf(DiscountRejectedError);
  });
});

describe('el carrito guardado de la organización', () => {
  async function conCarrito() {
    const m = await mundo();
    const get = new GetCartUseCase(m.uow.repos.carts, m.uow.repos.plugins);
    return { ...m, get, add: new AddToCartUseCase(m.uow), remove: new RemoveFromCartUseCase(m.uow), clear: new ClearCartUseCase(m.uow) };
  }

  it('lo agregado queda guardado, en orden, y lo ve toda la organización', async () => {
    const { add, get, e, a } = await conCarrito();
    await add.execute('org-1', e.code, 'user-1');
    await add.execute('org-1', a.code, 'user-2');

    const items = await get.execute('org-1');
    expect(items.map((i) => i.code)).toEqual(['mod.e', 'mod.a']);
    expect(items.map((i) => i.addedByUserId)).toEqual(['user-1', 'user-2']);
    expect(await get.execute('org-2')).toEqual([]);
  });

  it('agregar dos veces es idempotente y deja un solo aviso', async () => {
    const { uow, add, get, e } = await conCarrito();
    await add.execute('org-1', e.code, 'u');
    await add.execute('org-1', e.code, 'u');

    expect(await get.execute('org-1')).toHaveLength(1);
    expect(uow.repos.events.filter((x) => x.type === 'pricing.cart.item_added')).toHaveLength(1);
  });

  it('no se puede agregar lo que no se puede activar', async () => {
    const { uow, add, activate, e } = await conCarrito();
    await uow.repos.plugins.save(createPlugin({ code: 'core.x', isCore: true }));
    await uow.repos.plugins.save(createPlugin({ code: 'wip.y', buildStatus: 'en_construccion', priceCents: 100 }));
    await activate.execute('org-1', e.code);

    await expect(add.execute('org-1', 'nope', null)).rejects.toBeInstanceOf(PluginNotFoundError);
    await expect(add.execute('org-1', 'core.x', null)).rejects.toBeInstanceOf(CorePluginNotConfigurableError);
    await expect(add.execute('org-1', 'wip.y', null)).rejects.toBeInstanceOf(PluginNotAvailableError);
    await expect(add.execute('org-1', e.code, null)).rejects.toBeInstanceOf(PluginAlreadyActiveError);
  });

  it('quitar y vaciar publican su aviso solo si había algo', async () => {
    const { uow, add, remove, clear, get, e, d } = await conCarrito();
    await add.execute('org-1', e.code, null);
    await add.execute('org-1', d.code, null);

    await remove.execute('org-1', e.code);
    await remove.execute('org-1', e.code);
    expect((await get.execute('org-1')).map((i) => i.code)).toEqual(['mod.d']);
    expect(uow.repos.events.filter((x) => x.type === 'pricing.cart.item_removed')).toHaveLength(1);

    await clear.execute('org-1');
    await clear.execute('org-1');
    expect(await get.execute('org-1')).toEqual([]);
    expect(uow.repos.events.filter((x) => x.type === 'pricing.cart.cleared')).toHaveLength(1);
  });

  it('al activar, lo activado sale del carrito; lo demás sigue pendiente', async () => {
    const { add, get, activate, e, d } = await conCarrito();
    await add.execute('org-1', e.code, null);
    await add.execute('org-1', d.code, null);

    await activate.executeMany('org-1', [e.code]);

    expect((await get.execute('org-1')).map((i) => i.code)).toEqual(['mod.d']);
  });

  it('si la activación falla, el carrito queda intacto', async () => {
    const { add, get, activate, e } = await conCarrito();
    await add.execute('org-1', e.code, null);

    await expect(activate.executeMany('org-1', [e.code], { discountCode: 'NOEXISTE' })).rejects.toBeDefined();

    expect((await get.execute('org-1')).map((i) => i.code)).toEqual(['mod.e']);
  });
});
