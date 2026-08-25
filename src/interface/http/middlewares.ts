import { Context, MiddlewareHandler } from 'hono';
import {
  AppError,
  ForbiddenError,
  OrganizationContextRequiredError,
} from '../../domain/errors';

export type ContextVariables = {
  organizationId: string;
  userId: string;
  permissions: string[];
};

export function contextMiddleware(): MiddlewareHandler<{
  Variables: ContextVariables;
}> {
  return async (c, next) => {
    const orgId = c.req.header('X-Organization-Id');
    const userId = c.req.header('X-User-Id');
    const perms = c.req.header('X-Permissions');

    if (orgId) c.set('organizationId', orgId);
    if (userId) c.set('userId', userId);
    if (perms) c.set('permissions', perms.split(',').map((p) => p.trim()));

    await next();
  };
}

export function requireOrganization(): MiddlewareHandler<{
  Variables: ContextVariables;
}> {
  return async (c, next) => {
    const orgId = c.get('organizationId');
    if (!orgId) throw new OrganizationContextRequiredError();
    await next();
  };
}

export function requirePermission(perm: string): MiddlewareHandler<{
  Variables: ContextVariables;
}> {
  return async (c, next) => {
    const perms = c.get('permissions') ?? [];
    if (!perms.includes(perm)) throw new ForbiddenError();
    await next();
  };
}

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      err.httpStatus as 400,
    );
  }

  console.error('[plugin-catalog-service] error no controlado:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' }, 500);
}
