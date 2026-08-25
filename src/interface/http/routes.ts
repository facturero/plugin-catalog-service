import { Hono } from 'hono';
import { GetCatalogUseCase } from '../../application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from '../../application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from '../../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../../application/use-cases/deactivate-plugin';
import { RequestCustomPluginUseCase } from '../../application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from '../../application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from '../../application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from '../../application/use-cases/reject-custom-plugin-request';
import {
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
  deactivatePluginController,
  fulfillCustomRequestController,
  getCatalogController,
  getOrganizationPluginsController,
  getPublicCatalogController,
  listMyCustomRequestsController,
  quoteController,
  rejectCustomRequestController,
  requestCustomPluginController,
} from './controllers';
import { ContextVariables, requireOrganization, requirePermission } from './middlewares';

type Vars = { Variables: ContextVariables };

export interface AppDependencies {
  useCases: {
    getCatalog: GetCatalogUseCase;
    getOrganizationPlugins: GetOrganizationPluginsUseCase;
    quoteActivation: QuoteActivationUseCase;
    activatePlugin: ActivatePluginUseCase;
    deactivatePlugin: DeactivatePluginUseCase;
    requestCustomPlugin: RequestCustomPluginUseCase;
    listMyCustomRequests: ListMyCustomRequestsUseCase;
    fulfillCustomRequest: FulfillCustomPluginRequestUseCase;
    rejectCustomRequest: RejectCustomPluginRequestUseCase;
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

  r.post('/admin/plugin-requests/:id/reject',
    requireOrganization(),
    requirePermission('plugins:admin'),
    validateParams(requestIdParamSchema),
    validateJson(rejectCustomRequestSchema),
    rejectCustomRequestController(useCases.rejectCustomRequest));

  return r;
}
