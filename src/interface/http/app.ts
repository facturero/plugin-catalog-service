import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { trace } from '@opentelemetry/api';
import { AppDependencies, adminRoutes, healthRoutes, organizationRoutes, publicRoutes } from './routes';
import { contextMiddleware, errorHandler } from './middlewares';

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    app.use('*', httpInstrumentationMiddleware({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'plugin-catalog-service',
      captureRequestHeaders: ['x-request-id'],
      // Sin `spanNameFactory` a propósito: el nombre por defecto usa la plantilla de ruta (/x/:id). Con el path real
      // cada recurso sería un nombre de span distinto y SigNoz no podría agrupar nada.
    }));
  }
  // Quién hizo la petición, en el span de servidor. Mismos nombres que usa el frontend (app.org_id / app.user_id): con ellos
  // se filtra una organización o una persona de punta a punta, del navegador al servicio. Los pone el gateway (JWT), no el cliente.
  app.use('*', async (c, next) => {
    const span = trace.getActiveSpan();
    if (span) {
      const org = c.req.header('x-organization-id');
      const user = c.req.header('x-user-id');
      if (org) span.setAttribute('app.org_id', org);
      if (user) span.setAttribute('app.user_id', user);
    }
    await next();
  });

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
