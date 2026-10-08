import { Hono } from 'hono';
import { GetCatalogUseCase } from '../../application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from '../../application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from '../../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../../application/use-cases/deactivate-plugin';
import { CancelPluginDeactivationUseCase } from '../../application/use-cases/cancel-plugin-deactivation';
import { RequestCustomPluginUseCase } from '../../application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from '../../application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from '../../application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from '../../application/use-cases/reject-custom-plugin-request';
import { ListBusinessProfilesUseCase } from '../../application/use-cases/list-business-profiles';
import { GetMyBusinessProfileUseCase } from '../../application/use-cases/get-my-business-profile';
import { ChooseBusinessProfileUseCase } from '../../application/use-cases/choose-business-profile';
import { GetBusinessProfileRecommendationsUseCase } from '../../application/use-cases/get-business-profile-recommendations';
import { ActivatePluginsBatchUseCase } from '../../application/use-cases/activate-plugins-batch';
import {
  activatePluginsBatchSchema,
  businessProfileCodeParamSchema,
  chooseBusinessProfileSchema,
  fulfillCustomRequestSchema,
  pluginCodeParamSchema,
  rejectCustomRequestSchema,
  requestCustomPluginSchema,
  requestIdParamSchema,
  validateJson,
  validateParams,
} from './validators';
import {
  activatePluginController,
  activatePluginsBatchController,
  chooseBusinessProfileController,
  deactivatePluginController,
  cancelPluginDeactivationController,
  fulfillCustomRequestController,
  getBusinessProfileRecommendationsController,
  getCatalogController,
  getMyBusinessProfileController,
  getOrganizationPluginsController,
  getPublicCatalogController,
  listBusinessProfilesController,
  listMyCustomRequestsController,
  quoteController,
  rejectCustomRequestController,
  requestCustomPluginController,
} from './controllers';
import { ContextVariables, requireOrganization, requirePermission } from './middlewares';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from '../../application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from '../../application/use-cases/list-my-discount-redemptions';
import { GetSubscriptionUseCase } from '../../application/use-cases/get-subscription';
import {
  createDiscountController,
  getSubscriptionController,
  listDiscountsController,
  listMyDiscountRedemptionsController,
  setDiscountActiveController,
  updateDiscountController,
} from './discount-controllers';
import { createDiscountSchema, discountIdParamSchema, updateDiscountSchema } from './discount-validators';

type Vars = { Variables: ContextVariables };

export interface AppDependencies {
  useCases: {
    getCatalog: GetCatalogUseCase;
    getOrganizationPlugins: GetOrganizationPluginsUseCase;
    quoteActivation: QuoteActivationUseCase;
    activatePlugin: ActivatePluginUseCase;
    deactivatePlugin: DeactivatePluginUseCase;
    cancelPluginDeactivation: CancelPluginDeactivationUseCase;
    requestCustomPlugin: RequestCustomPluginUseCase;
    listMyCustomRequests: ListMyCustomRequestsUseCase;
    fulfillCustomRequest: FulfillCustomPluginRequestUseCase;
    rejectCustomRequest: RejectCustomPluginRequestUseCase;
    listBusinessProfiles: ListBusinessProfilesUseCase;
    getMyBusinessProfile: GetMyBusinessProfileUseCase;
    chooseBusinessProfile: ChooseBusinessProfileUseCase;
    getBusinessProfileRecommendations: GetBusinessProfileRecommendationsUseCase;
    activatePluginsBatch: ActivatePluginsBatchUseCase;
    listDiscounts: ListDiscountsUseCase;
    createDiscount: CreateDiscountUseCase;
    updateDiscount: UpdateDiscountUseCase;
    setDiscountActive: SetDiscountActiveUseCase;
    listMyDiscountRedemptions: ListMyDiscountRedemptionsUseCase;
    getSubscription: GetSubscriptionUseCase;
  };
  corsOrigin: string;
}

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}

/** Catálogo público: sin X-Organization-Id, solo plugins created_for_organization_id IS NULL. */
export function publicRoutes(deps: AppDependencies): Hono {
  const r = new Hono();
  r.get('/plugins', getPublicCatalogController(deps.useCases.getCatalog));
  r.get('/business-profiles', listBusinessProfilesController(deps.useCases.listBusinessProfiles));
  return r;
}

export function organizationRoutes(deps: AppDependencies): Hono<Vars> {
  const r = new Hono<Vars>();
  const { useCases } = deps;

  r.get('/organizations/me/plugins/catalog',
    requireOrganization(),
    getCatalogController(useCases.getCatalog));

  r.get('/organizations/me/plugins',
    requireOrganization(),
    getOrganizationPluginsController(useCases.getOrganizationPlugins));

  r.get('/organizations/me/plugin-requests',
    requireOrganization(),
    listMyCustomRequestsController(useCases.listMyCustomRequests));

  r.post('/organizations/me/plugin-requests',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateJson(requestCustomPluginSchema),
    requestCustomPluginController(useCases.requestCustomPlugin));

  // Prueba gratis e IVA de la organización. Lo llama el frontend al cargar; el administrador arranca la prueba.
  r.get('/organizations/me/subscription',
    requireOrganization(),
    getSubscriptionController(useCases.getSubscription));

  // Los descuentos que esta organización ya canjeó (qué se le prometió pagar).
  r.get('/organizations/me/discount-redemptions',
    requireOrganization(),
    listMyDiscountRedemptionsController(useCases.listMyDiscountRedemptions));

  // :code dinámico va al final para no chocar con las rutas estáticas de arriba.
  r.get('/organizations/me/plugins/:code/quote',
    requireOrganization(),
    validateParams(pluginCodeParamSchema),
    quoteController(useCases.quoteActivation));

  r.post('/organizations/me/plugins/:code/activate',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateParams(pluginCodeParamSchema),
    activatePluginController(useCases.activatePlugin));

  r.post('/organizations/me/plugins/:code/deactivate',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateParams(pluginCodeParamSchema),
    deactivatePluginController(useCases.deactivatePlugin));

  r.post('/organizations/me/plugins/:code/cancel-deactivation',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateParams(pluginCodeParamSchema),
    cancelPluginDeactivationController(useCases.cancelPluginDeactivation));

  // Perfiles de negocio (recomendación de plugins)
  r.get('/organizations/me/business-profile',
    requireOrganization(),
    getMyBusinessProfileController(useCases.getMyBusinessProfile));

  r.put('/organizations/me/business-profile',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateJson(chooseBusinessProfileSchema),
    chooseBusinessProfileController(useCases.chooseBusinessProfile));

  r.get('/organizations/me/business-profiles/:code/recommendations',
    requireOrganization(),
    validateParams(businessProfileCodeParamSchema),
    getBusinessProfileRecommendationsController(useCases.getBusinessProfileRecommendations));

  r.post('/organizations/me/plugins/activate',
    requireOrganization(),
    requirePermission('plugins:manage'),
    validateJson(activatePluginsBatchSchema),
    activatePluginsBatchController(useCases.activatePluginsBatch));

  return r;
}

/**
 * Rutas administrativas (operación manual del equipo, ej. desde Postman):
 * protegidas por el mismo esquema de cabeceras del gateway con el permiso
 * 'plugins:admin'. No hay panel de administración en este MVP.
 */
export function adminRoutes(deps: AppDependencies): Hono<Vars> {
  const r = new Hono<Vars>();
  const { useCases } = deps;

  r.post('/admin/plugin-requests/:id/fulfill',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(requestIdParamSchema),
    validateJson(fulfillCustomRequestSchema),
    fulfillCustomRequestController(useCases.fulfillCustomRequest));

  // Descuentos: se administran con el permiso plugins:admin, igual que las solicitudes de módulos a medida.
  r.get('/admin/discounts',
    requireOrganization(),
    requirePermission('plugins:admin'),
    listDiscountsController(useCases.listDiscounts));

  r.post('/admin/discounts',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateJson(createDiscountSchema),
    createDiscountController(useCases.createDiscount));

  r.patch('/admin/discounts/:id',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(discountIdParamSchema),
    validateJson(updateDiscountSchema),
    updateDiscountController(useCases.updateDiscount));

  r.post('/admin/discounts/:id/deactivate',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(discountIdParamSchema),
    setDiscountActiveController(useCases.setDiscountActive, false));

  r.post('/admin/discounts/:id/reactivate',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(discountIdParamSchema),
    setDiscountActiveController(useCases.setDiscountActive, true));

  r.post('/admin/plugin-requests/:id/reject',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(requestIdParamSchema),
    validateJson(rejectCustomRequestSchema),
    rejectCustomRequestController(useCases.rejectCustomRequest));

  return r;
}
