import { serve } from '@hono/node-server';
import { sequelize } from './infrastructure/persistence/sequelize';
import './infrastructure/persistence/models';
import { buildRepositories, SequelizeUnitOfWork } from './infrastructure/persistence/repositories';
import { config } from './infrastructure/config';
import { GetCatalogUseCase } from './application/use-cases/get-catalog';
import { GetOrganizationPluginsUseCase } from './application/use-cases/get-organization-plugins';
import { QuoteActivationUseCase } from './application/use-cases/quote-activation';
import { ActivatePluginUseCase } from './application/use-cases/activate-plugin';
import {
  CreateDiscountUseCase,
  ListDiscountsUseCase,
  SetDiscountActiveUseCase,
  UpdateDiscountUseCase,
} from './application/use-cases/manage-discounts';
import { ListMyDiscountRedemptionsUseCase } from './application/use-cases/list-my-discount-redemptions';
import { GetSubscriptionUseCase } from './application/use-cases/get-subscription';
import { PricingPolicy } from './application/pricing-policy';
import { DeactivatePluginUseCase } from './application/use-cases/deactivate-plugin';
import { AddToCartUseCase, ClearCartUseCase, GetCartUseCase, RemoveFromCartUseCase } from './application/use-cases/cart';
import { CancelPluginDeactivationUseCase } from './application/use-cases/cancel-plugin-deactivation';
import { ApplyDueDeactivationsUseCase } from './application/use-cases/apply-due-deactivations';
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
import { OutboxRelay, runWithActor } from '@facturero/outbox-relay';

async function bootstrap(): Promise<void> {
  await sequelize.authenticate();
  console.log('[plugin-catalog-service] Conectado a la base de datos.');

  let relay: OutboxRelay | undefined;
  const unitOfWork = new SequelizeUnitOfWork((tx) => relay?.attachToTransaction(tx));
  const repos = buildRepositories();
  // Prueba gratis de la organización e IVA: vienen del entorno (TRIAL_MONTHS, VAT_BPS).
  const pricingPolicy: PricingPolicy = { trialMonths: config.TRIAL_MONTHS, vatBps: config.VAT_BPS };

  const deactivatePlugin = new DeactivatePluginUseCase(unitOfWork);

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
        repos.organizationTrials,
      ),
      quoteActivation: new QuoteActivationUseCase(
        repos.plugins,
        repos.dependencies,
        repos.organizationPlugins,
        repos.translations,
        repos.discounts,
        repos.discountRedemptions,
        repos.organizationTrials,
        pricingPolicy,
      ),
      activatePlugin: new ActivatePluginUseCase(unitOfWork),
      deactivatePlugin,
      cancelPluginDeactivation: new CancelPluginDeactivationUseCase(unitOfWork),
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
      listDiscounts: new ListDiscountsUseCase(unitOfWork),
      createDiscount: new CreateDiscountUseCase(unitOfWork),
      updateDiscount: new UpdateDiscountUseCase(unitOfWork),
      setDiscountActive: new SetDiscountActiveUseCase(unitOfWork),
      listMyDiscountRedemptions: new ListMyDiscountRedemptionsUseCase(repos.discounts, repos.discountRedemptions),
      getSubscription: new GetSubscriptionUseCase(unitOfWork, pricingPolicy),
      getCart: new GetCartUseCase(repos.carts, repos.plugins),
      addToCart: new AddToCartUseCase(unitOfWork),
      removeFromCart: new RemoveFromCartUseCase(unitOfWork),
      clearCart: new ClearCartUseCase(unitOfWork),
    },
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: app.fetch, port: config.PORT }, () => {
    console.log(`[plugin-catalog-service] Escuchando en el puerto ${config.PORT}.`);
  });

  // Las bajas programadas se cumplen aquí: al arrancar y cada cierto tiempo se apaga lo que ya cumplió su periodo pago.
  const applyDue = new ApplyDueDeactivationsUseCase(unitOfWork, repos.organizationPlugins, repos.plugins, deactivatePlugin);
  const sweep = () =>
    runWithActor({ actorId: null, actorEmail: 'sistema', actorIp: null, requestId: null }, () => applyDue.execute())
      .then((n) => n > 0 && console.log(`[plugin-catalog-service] ${n} módulo(s) apagado(s) por fin de periodo.`))
      .catch((err) => console.error('[plugin-catalog-service] Falló el barrido de bajas programadas:', err));
  setInterval(sweep, config.DEACTIVATION_SWEEP_SECONDS * 1000).unref();
  void sweep();

  if (config.RABBITMQ_URL) {
    relay = new OutboxRelay({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
    });
    relay
      .start()
      .then(() => console.log('[plugin-catalog-service] Outbox relay conectado a RabbitMQ.'))
      .catch((err) => console.error('[plugin-catalog-service] No se pudo iniciar el outbox relay:', err));
  }
}

bootstrap().catch((err) => {
  console.error('[plugin-catalog-service] Error fatal al arrancar:', err);
  process.exit(1);
});
