import {
  Plugin, PluginDependency, OrganizationPlugin, PluginCustomRequest,
  BusinessProfile, BusinessProfilePlugin, OrganizationBusinessProfile,
} from './entities';
import { Discount } from './discount';
import { OrganizationTrial } from './trial';

export interface DomainEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface PluginRepository {
  findByCode(code: string): Promise<Plugin | null>;
  findById(id: string): Promise<Plugin | null>;
  listAll(): Promise<Plugin[]>;
  listByCodes(codes: string[]): Promise<Plugin[]>;
  /** Públicos + privados de la organización. Con organizationId=null solo públicos. */
  listVisibleTo(organizationId: string | null): Promise<Plugin[]>;
  save(plugin: Plugin): Promise<void>;
}

/** Traducción de los campos de texto de un plugin a un idioma concreto. */
export interface PluginTranslation {
  pluginId: string;
  name: string;
  category: string;
  description: string;
}

export interface PluginTranslationRepository {
  /**
   * Traducciones de todos los plugins para un idioma. Devuelve un mapa vacío si
   * el idioma no tiene traducciones cargadas: quien llama cae al idioma base.
   */
  mapByLocale(locale: string): Promise<Map<string, PluginTranslation>>;
}

export interface PluginDependencyRepository {
  /** Todas las aristas del grafo (tabla pequeña). */
  listAll(): Promise<PluginDependency[]>;
  /** Plugins de los que `pluginId` depende directamente. */
  listDependenciesOf(pluginId: string): Promise<PluginDependency[]>;
  /** Plugins que dependen directamente de `pluginId`. */
  listDependentsOf(pluginId: string): Promise<PluginDependency[]>;
  /** BFS transitivo partiendo de `pluginId`, sin duplicados; lanza si detecta un ciclo. */
  resolveTransitiveDependencies(pluginId: string): Promise<PluginDependency[]>;
}

export interface OrganizationPluginRepository {
  listByOrganization(organizationId: string): Promise<OrganizationPlugin[]>;
  find(organizationId: string, pluginId: string): Promise<OrganizationPlugin | null>;
  save(op: OrganizationPlugin): Promise<void>;
  delete(organizationId: string, pluginId: string): Promise<void>;
}

export interface PluginCustomRequestRepository {
  findById(id: string): Promise<PluginCustomRequest | null>;
  listByOrganization(organizationId: string): Promise<PluginCustomRequest[]>;
  save(request: PluginCustomRequest): Promise<void>;
}

export interface OutboxRepository {
  add(event: DomainEvent): Promise<void>;
}

export interface BusinessProfileTranslation {
  businessProfileId: string;
  name: string;
  description: string;
}

export interface BusinessProfileRepository {
  listActive(): Promise<BusinessProfile[]>;
  findById(id: string): Promise<BusinessProfile | null>;
  findByCode(code: string): Promise<BusinessProfile | null>;
  findPlugins(profileId: string): Promise<BusinessProfilePlugin[]>;
  findTranslation(profileId: string, locale: string): Promise<BusinessProfileTranslation | null>;
}

export interface OrganizationBusinessProfileRepository {
  find(organizationId: string): Promise<OrganizationBusinessProfile | null>;
  upsert(obp: OrganizationBusinessProfile): Promise<void>;
}

export interface Repositories {
  plugins: PluginRepository;
  translations: PluginTranslationRepository;
  dependencies: PluginDependencyRepository;
  organizationPlugins: OrganizationPluginRepository;
  customRequests: PluginCustomRequestRepository;
  outbox: OutboxRepository;
  businessProfiles: BusinessProfileRepository;
  organizationBusinessProfiles: OrganizationBusinessProfileRepository;
  discounts: DiscountRepository;
  discountRedemptions: DiscountRedemptionRepository;
  organizationTrials: OrganizationTrialRepository;
}

// ── Descuentos ────────────────────────────────────────────────────────────────

export interface DiscountRedemption {
  id: string;
  discountId: string;
  organizationId: string;
  /** El módulo que la persona eligió activar al canjear. */
  pluginCode: string;
  redeemedByUserId: string | null;
  listCents: number;
  discountCents: number;
  finalCents: number;
  redeemedAt: Date;
  /** null = dura mientras el módulo siga activo. */
  expiresAt: Date | null;
}

export interface DiscountRepository {
  findByCode(code: string): Promise<Discount | null>;
  /** Igual que `findByCode` pero bloquea la fila hasta el final de la transacción: dos canjes a la vez no pasan el tope. */
  findByCodeForUpdate(code: string): Promise<Discount | null>;
  findById(id: string): Promise<Discount | null>;
  list(): Promise<Discount[]>;
  save(discount: Discount): Promise<void>;
}

export interface DiscountRedemptionRepository {
  countByOrganization(discountId: string, organizationId: string): Promise<number>;
  add(redemption: DiscountRedemption): Promise<void>;
  listByOrganization(organizationId: string): Promise<DiscountRedemption[]>;
}

// ── Prueba gratis ─────────────────────────────────────────────────────────────

export interface OrganizationTrialRepository {
  find(organizationId: string): Promise<OrganizationTrial | null>;
  /** Crea la prueba solo si la organización no tenía una. true = la creó ahora. Dos llamadas a la vez crean una sola. */
  insertIfAbsent(trial: OrganizationTrial): Promise<boolean>;
}
