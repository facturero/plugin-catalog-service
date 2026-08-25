import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { AppDependencies, adminRoutes, healthRoutes, organizationRoutes, publicRoutes } from './routes';
import { contextMiddleware, errorHandler } from './middlewares';

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', contextMiddleware());
  app.use(
    '*',
    cors({
      origin: deps.corsOrigin,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id', 'X-User-Id', 'X-Permissions'],
    }),
  );

  app.route('/', healthRoutes());
  app.route('/', publicRoutes(deps));
  app.route('/', organizationRoutes(deps));
  app.route('/', adminRoutes(deps));

  app.onError(errorHandler);
  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'Recurso no encontrado.' }, 404));

  return app;
}
