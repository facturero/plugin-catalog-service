import { serve } from '@hono/node-server';
import { sequelize } from './infrastructure/persistence/sequelize';
import './infrastructure/persistence/models';
import { buildRepositories, SequelizeUnitOfWork } from './infrastructure/persistence/repositories';
import { config } from './infrastructure/config';
import { GetCatalogUseCase } from './application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from './application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from './application/use-cases/quote-activation';
import { ActivatePluginUseCase } from './application/use-cases/activate-plugin';
import { DeactivatePluginUseCase } from './application/use-cases/deactivate-plugin';
import { RequestCustomPluginUseCase } from './application/use-cases/request-custom-plugin';
import { ListMyCustomRequestsUseCase } from './application/use-cases/list-my-custom-requests';
import { FulfillCustomPluginRequestUseCase } from './application/use-cases/fulfill-custom-plugin-request';
import { RejectCustomPluginRequestUseCase } from './application/use-cases/reject-custom-plugin-request';
import { ListBusinessProfilesUseCase } from './application/use-cases/list-business-profiles';
import { GetMyBusinessProfileUseCase } from './application/use-cases/get-my-business-profile';
import { ChooseBusinessProfileUseCase } from './application/use-cases/choose-business-profile';
import { GetBusinessProfileRecommendationsUseCase } from './application/use-cases/get-business-profile-recommendations';
import { ActivatePluginsBatchUseCase } from './application/use-cases/activate-plugins-batch';
import { createApp } from './interface/http/app';
import { OutboxRelay } from '@facturero/outbox-relay';

async function bootstrap(): Promise<void> {
  await sequelize.authenticate();
  console.log('[plugin-catalog-service] Conectado a la base de datos.');

  const unitOfWork = new SequelizeUnitOfWork();
  const repos = buildRepositories();

  const app = createApp({
    useCases: {
      getCatalog: new GetCatalogUseCase(
        repos.plugins,
        repos.dependencies,
        repos.organizationPlugins,
        repos.translations,
      ),
      getOrganizationPlugins: new GetOrganizationPluginsUseCase(
        repos.organizationPlugins,
        repos.plugins,
        repos.translations,
      ),
      quoteActivation: new QuoteActivationUseCase(
        repos.plugins,
        repos.dependencies,
        repos.organizationPlugins,
        repos.translations,
      ),
      activatePlugin: new ActivatePluginUseCase(unitOfWork),
      deactivatePlugin: new DeactivatePluginUseCase(unitOfWork),
      requestCustomPlugin: new RequestCustomPluginUseCase(unitOfWork),
      listMyCustomRequests: new ListMyCustomRequestsUseCase(repos.customRequests),
      fulfillCustomRequest: new FulfillCustomPluginRequestUseCase(unitOfWork),
      rejectCustomRequest: new RejectCustomPluginRequestUseCase(unitOfWork),
      listBusinessProfiles: new ListBusinessProfilesUseCase(repos.businessProfiles),
      getMyBusinessProfile: new GetMyBusinessProfileUseCase(
        repos.businessProfiles,
        repos.organizationBusinessProfiles,
      ),
      chooseBusinessProfile: new ChooseBusinessProfileUseCase(unitOfWork),
      getBusinessProfileRecommendations: new GetBusinessProfileRecommendationsUseCase(
        repos.businessProfiles,
        repos.plugins,
        repos.dependencies,
        repos.organizationPlugins,
        repos.translations,
      ),
      activatePluginsBatch: new ActivatePluginsBatchUseCase(
        new ActivatePluginUseCase(unitOfWork),
      ),
    },
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: app.fetch, port: config.PORT }, () => {
    console.log(`[plugin-catalog-service] Escuchando en el puerto ${config.PORT}.`);
  });

  if (config.RABBITMQ_URL) {
    new OutboxRelay({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
    })
      .start()
      .then(() => console.log('[plugin-catalog-service] Outbox relay conectado a RabbitMQ.'))
      .catch((err) => console.error('[plugin-catalog-service] No se pudo iniciar el outbox relay:', err));
  }
}

bootstrap().catch((err) => {
  console.error('[plugin-catalog-service] Error fatal al arrancar:', err);
  process.exit(1);
});
