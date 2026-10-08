import { describe, expect, it } from 'vitest';
import { createApp } from '../interface/http/app';
import { AppDependencies } from '../interface/http/routes';
import { GetCatalogUseCase } from '../application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from '../application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from '../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../application/use-cases/deactivate-plugin';
import { RequestCustomPluginUseCase } from '../application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from '../application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from '../application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from '../application/use-cases/reject-custom-plugin-request';
import { ListBusinessProfilesUseCase } from '../application/use-cases/list-business-profiles';
import { GetMyBusinessProfileUseCase } from '../application/use-cases/get-my-business-profile';
import { ChooseBusinessProfileUseCase } from '../application/use-cases/choose-business-profile';
import { GetBusinessProfileRecommendationsUseCase } from '../application/use-cases/get-business-profile-recommendations';
import { ActivatePluginsBatchUseCase } from '../application/use-cases/activate-plugins-batch';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from '../application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from '../application/use-cases/list-my-discount-redemptions';
import { GetSubscriptionUseCase } from '../application/use-cases/get-subscription';
import { DEFAULT_PRICING_POLICY } from '../application/pricing-policy';
import { createInMemoryUow, seedExampleWorld } from './helpers';

function montar() {
  const uow = createInMemoryUow();
  const world = seedExampleWorld(uow.repos);
  const r = uow.repos;
  const deps: AppDependencies = {
    useCases: {
      getCatalog: new GetCatalogUseCase(r.plugins, r.dependencies, r.organizationPlugins, r.translations),
      getOrganizationPlugins: new GetOrganizationPluginsUseCase(r.organizationPlugins, r.plugins, r.translations),
      quoteActivation: new QuoteActivationUseCase(r.plugins, r.dependencies, r.organizationPlugins, r.translations, r.discounts, r.discountRedemptions, r.organizationTrials, DEFAULT_PRICING_POLICY),
      activatePlugin: new ActivatePluginUseCase(uow),
      deactivatePlugin: new DeactivatePluginUseCase(uow),
      requestCustomPlugin: new RequestCustomPluginUseCase(uow),
      listMyCustomRequests: new ListMyCustomRequestsUseCase(r.customRequests),
      fulfillCustomRequest: new FulfillCustomPluginRequestUseCase(uow),
      rejectCustomRequest: new RejectCustomPluginRequestUseCase(uow),
      listBusinessProfiles: new ListBusinessProfilesUseCase(r.businessProfiles),
      getMyBusinessProfile: new GetMyBusinessProfileUseCase(r.businessProfiles, r.organizationBusinessProfiles),
      chooseBusinessProfile: new ChooseBusinessProfileUseCase(uow),
      getBusinessProfileRecommendations: new GetBusinessProfileRecommendationsUseCase(r.businessProfiles, r.plugins, r.dependencies, r.organizationPlugins, r.translations),
      activatePluginsBatch: new ActivatePluginsBatchUseCase(new ActivatePluginUseCase(uow)),
      listDiscounts: new ListDiscountsUseCase(uow),
      createDiscount: new CreateDiscountUseCase(uow),
      updateDiscount: new UpdateDiscountUseCase(uow),
      setDiscountActive: new SetDiscountActiveUseCase(uow),
      listMyDiscountRedemptions: new ListMyDiscountRedemptionsUseCase(r.discounts, r.discountRedemptions),
      getSubscription: new GetSubscriptionUseCase(uow, DEFAULT_PRICING_POLICY),
    },
    corsOrigin: '*',
  };
  const app = createApp(deps);

  const llamar = (method: string, path: string, opts: { permisos?: string; org?: string; body?: unknown } = {}) =>
    app.request(path, {
      method,
      headers: {
        'X-Organization-Id': opts.org ?? 'org-1',
        'X-User-Id': 'user-1',
        'X-Permissions': opts.permisos ?? 'plugins:manage',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  return { uow, ...world, llamar };
}

const admin = { permisos: 'plugins:manage,plugins:admin' };

describe('HTTP · administrar descuentos', () => {
  it('sin plugins:admin, crear / listar / cambiar un descuento responde 403', async () => {
    const { llamar } = montar();
    const body = { code: 'HOLA', name: 'Hola', percent: 10 };
    expect((await llamar('POST', '/admin/discounts', { body })).status).toBe(403);
    expect((await llamar('GET', '/admin/discounts')).status).toBe(403);
    expect((await llamar('PATCH', '/admin/discounts/6f9619ff-8b86-4d11-b42d-00c04fc964ff', { body: { name: 'x' } })).status).toBe(403);
  });

  it('crear con `percent: 12.5` guarda 1250 puntos básicos y devuelve el porcentaje legible', async () => {
    const { llamar } = montar();
    const res = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'doce', name: 'Doce y medio', percent: 12.5 } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ code: 'DOCE', kind: 'percent', value: 1250, percent: 12.5, amountCents: null });
  });

  it('crear con `amountCents` es un descuento de monto fijo', async () => {
    const { llamar } = montar();
    const res = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'CINCO', name: 'Cinco dólares', amountCents: 500 } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ kind: 'fixed', value: 500, percent: null, amountCents: 500 });
  });

  it('mandar `percent` y `amountCents` a la vez, o ninguno, es un error de validación', async () => {
    const { llamar } = montar();
    const ambos = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'AMBOS', name: 'x', percent: 10, amountCents: 100 } });
    const ninguno = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'NINGUNO', name: 'x' } });
    expect(ambos.status).toBe(422);
    expect(ninguno.status).toBe(422);
  });

  it('un código repetido responde 409', async () => {
    const { llamar } = montar();
    const body = { code: 'REPE', name: 'Repe', percent: 10 };
    await llamar('POST', '/admin/discounts', { ...admin, body });
    expect((await llamar('POST', '/admin/discounts', { ...admin, body })).status).toBe(409);
  });

  it('desactivar y reactivar', async () => {
    const { llamar } = montar();
    const creado = await (await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'ONOFF', name: 'On off', percent: 10 } })).json() as { id: string };
    const off = await llamar('POST', `/admin/discounts/${creado.id}/deactivate`, admin);
    expect(await off.json()).toMatchObject({ isActive: false });
    const on = await llamar('POST', `/admin/discounts/${creado.id}/reactivate`, admin);
    expect(await on.json()).toMatchObject({ isActive: true });
  });
});

describe('HTTP · usar un código', () => {
  async function conCodigo(percent = 20) {
    const m = montar();
    await m.llamar('POST', '/admin/discounts', { ...admin, body: { code: 'VEINTE', name: 'Veinte', percent } });
    return m;
  }

  it('la cotización con ?discountCode= trae el total con descuento', async () => {
    const { llamar, a } = await conCodigo();
    const res = await llamar('GET', `/organizations/me/plugins/${a.code}/quote?discountCode=veinte`);
    const q = (await res.json()) as { total_monthly: number; total_after_discount: number };
    expect(res.status).toBe(200);
    expect(q).toMatchObject({ total_monthly: 3500, total_after_discount: 2800 });
  });

  it('un código malo no tumba la cotización: 200 con discount_error', async () => {
    const { llamar, a } = await conCodigo();
    const res = await llamar('GET', `/organizations/me/plugins/${a.code}/quote?discountCode=NOEXISTE`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total_monthly: 3500, discount_error: { code: 'DISCOUNT_NOT_FOUND' } });
  });

  it('activar con un POST SIN cuerpo sigue funcionando (compatibilidad con el front actual)', async () => {
    const { llamar, c } = await conCodigo();
    const res = await llamar('POST', `/organizations/me/plugins/${c.code}/activate`);
    expect(res.status).toBe(200);
  });

  it('activar con {discountCode} canjea; un código malo responde 404/422 y no activa nada', async () => {
    const { llamar, c, uow } = await conCodigo();
    const malo = await llamar('POST', `/organizations/me/plugins/${c.code}/activate`, { body: { discountCode: 'NOEXISTE' } });
    expect(malo.status).toBe(404);
    expect(await uow.repos.organizationPlugins.listByOrganization('org-1')).toHaveLength(0);

    const bueno = await llamar('POST', `/organizations/me/plugins/${c.code}/activate`, { body: { discountCode: 'VEINTE' } });
    expect(bueno.status).toBe(200);

    const mios = await (await llamar('GET', '/organizations/me/discount-redemptions')).json();
    expect(mios).toMatchObject([{ discountCode: 'VEINTE', pluginCode: c.code, listCents: 500, discountCents: 100, finalCents: 400 }]);

    const otraVez = await llamar('POST', `/organizations/me/plugins/${c.code}/activate`, { body: { discountCode: 'VEINTE' } });
    expect(otraVez.status).toBeGreaterThanOrEqual(400);
  });

  it('un código vencido responde 422 con su motivo', async () => {
    const m = montar();
    await m.llamar('POST', '/admin/discounts', {
      ...admin,
      body: { code: 'VIEJO', name: 'Viejo', percent: 10, validFrom: '2020-01-01T00:00:00-05:00', validUntil: '2020-02-01T00:00:00-05:00' },
    });
    const res = await m.llamar('POST', `/organizations/me/plugins/${m.c.code}/activate`, { body: { discountCode: 'VIEJO' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'DISCOUNT_EXPIRED' });
  });
});

describe('HTTP · prueba gratis e IVA', () => {
  it('el administrador (plugins:manage) arranca la prueba al consultar; los demás solo leen', async () => {
    const { llamar } = montar();

    const vendedor = await llamar('GET', '/organizations/me/subscription', { permisos: 'invoice:create' });
    expect(await vendedor.json()).toMatchObject({ trial: null, vat_percent: 15 });

    const admin1 = await llamar('GET', '/organizations/me/subscription');
    const cuerpo = (await admin1.json()) as { trial: { active: boolean; days_left: number } };
    expect(admin1.status).toBe(200);
    expect(cuerpo.trial.active).toBe(true);
    expect(cuerpo.trial.days_left).toBeGreaterThan(85);

    const vendedorDespues = await llamar('GET', '/organizations/me/subscription', { permisos: 'invoice:create' });
    expect(((await vendedorDespues.json()) as { trial: unknown }).trial).not.toBeNull();
  });

  it('la cotización trae el IVA y lo que se paga hoy', async () => {
    const { llamar, a } = montar();
    await llamar('GET', '/organizations/me/subscription');
    const res = await llamar('GET', `/organizations/me/plugins/${a.code}/quote`);
    expect(await res.json()).toMatchObject({ total_monthly: 3500, vat_percent: 15, vat_cents: 525, total_with_vat: 4025, due_today: 0 });
  });

  it('crear un descuento de monto fijo por módulo (por defecto) o sobre el total', async () => {
    const { llamar } = montar();
    const porModulo = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'DOSXMODULO', name: 'x', amountCents: 200 } });
    expect(await porModulo.json()).toMatchObject({ kind: 'fixed', fixedAppliesTo: 'plugin' });
    const total = await llamar('POST', '/admin/discounts', { ...admin, body: { code: 'DOSTOTAL', name: 'x', amountCents: 200, fixedAppliesTo: 'total' } });
    expect(await total.json()).toMatchObject({ kind: 'fixed', fixedAppliesTo: 'total' });
  });
});
