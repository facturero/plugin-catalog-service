import { Plugin, PluginDependency, OrganizationPlugin, PluginCustomRequest } from './entities';

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

export interface Repositories {
  plugins: PluginRepository;
  translations: PluginTranslationRepository;
  dependencies: PluginDependencyRepository;
  organizationPlugins: OrganizationPluginRepository;
  customRequests: PluginCustomRequestRepository;
  outbox: OutboxRepository;
}
