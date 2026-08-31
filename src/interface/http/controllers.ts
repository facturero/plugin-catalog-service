import { Context } from 'hono';
import { GetCatalogUseCase } from '../../application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from '../../application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from '../../application/use-cases/quote-activation';
import { ActivatePluginUseCase } from '../../application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from '../../application/use-cases/deactivate-plugin';
import { RequestCustomPluginUseCase } from '../../application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from '../../application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from '../../application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from '../../application/use-cases/reject-custom-plugin-request';
import { ContextVariables } from './middlewares';

type Ctx = Context<{ Variables: ContextVariables }>;

export function getPublicCatalogController(useCase: GetCatalogUseCase) {
  return async (c: Ctx) => {
    const result = await useCase.execute(null, c.get('locale'));
    return c.json(result, 200);
  };
}

export function getCatalogController(useCase: GetCatalogUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const result = await useCase.execute(orgId, c.get('locale'));
    return c.json(result, 200);
  };
}

export function getOrganizationPluginsController(useCase: GetOrganizationPluginsUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const result = await useCase.execute(orgId, c.get('locale'));
    return c.json(result, 200);
  };
}

export function quoteController(useCase: QuoteActivationUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const { code } = c.req.valid('param' as never) as { code: string };
    const result = await useCase.execute(orgId, code, c.get('locale'));
    return c.json(result, 200);
  };
}

export function activatePluginController(useCase: ActivatePluginUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const { code } = c.req.valid('param' as never) as { code: string };
    const result = await useCase.execute(orgId, code);
    return c.json(result, 200);
  };
}

export function deactivatePluginController(useCase: DeactivatePluginUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const { code } = c.req.valid('param' as never) as { code: string };
    const result = await useCase.execute(orgId, code);
    return c.json(result, 200);
  };
}

export function requestCustomPluginController(useCase: RequestCustomPluginUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const body = c.req.valid('json' as never) as {
      description: string;
      basedOnPluginCodes: string[];
    };
    const result = await useCase.execute({
      organizationId: orgId,
      description: body.description,
      basedOnPluginCodes: body.basedOnPluginCodes,
    });
    return c.json(result, 201);
  };
}

export function listMyCustomRequestsController(useCase: ListMyCustomRequestsUseCase) {
  return async (c: Ctx) => {
    const orgId = c.get('organizationId');
    const result = await useCase.execute(orgId);
    return c.json(result, 200);
  };
}

export function fulfillCustomRequestController(useCase: FulfillCustomPluginRequestUseCase) {
  return async (c: Ctx) => {
    const { id } = c.req.valid('param' as never) as { id: string };
    const body = c.req.valid('json' as never) as {
      name: string;
      description: string;
      priceCents: number;
      imageUrl?: string | null;
      basedOnPluginId?: string | null;
    };
    const result = await useCase.execute({
      requestId: id,
      name: body.name,
      description: body.description,
      priceCents: body.priceCents,
      imageUrl: body.imageUrl,
      basedOnPluginId: body.basedOnPluginId,
    });
    return c.json(result, 201);
  };
}

export function rejectCustomRequestController(useCase: RejectCustomPluginRequestUseCase) {
  return async (c: Ctx) => {
    const { id } = c.req.valid('param' as never) as { id: string };
    const body = c.req.valid('json' as never) as { reason: string };
    const result = await useCase.execute(id, body.reason);
    return c.json(result, 200);
  };
}
