export interface PluginDTO {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string | null;
  buildStatus: 'disponible' | 'en_construccion' | 'descontinuado';
  priceCents: number;
  currency: string;
  isActive: boolean;
  isCore: boolean;
  isPublic: boolean;
  createdForOrganizationId: string | null;
  basedOnPluginId: string | null;
}

export type DisplayStatus =
  | 'en_construccion'
  | 'disponible'
  | 'comprado'
  | 'desactivado'
  /** Plugin del nucleo: activo para todos, no se compra ni se apaga. */
  | 'incluido';

export interface CatalogPluginDTO extends PluginDTO {
  display_status: DisplayStatus;
  is_exclusive: boolean;
  depends_on: { code: string; name: string; autoActivate: boolean }[];
}

export interface OrganizationPluginDTO {
  organizationId: string;
  pluginId: string;
  pluginCode?: string;
  pluginName?: string;
  /** `included`: viene con la plataforma (núcleo y módulos base gratuitos); no se compra ni se apaga. */
  activationSource: 'direct' | 'dependency' | 'included';
  requiredByPluginId: string | null;
  status: 'active' | 'disabled';
  activatedAt: Date;
  deactivatedAt: Date | null;
  /** Desactivación programada: sigue activo hasta esta fecha. */
  deactivateAt?: Date | null;
  /** Un módulo desactivado cuyo periodo pago no ha terminado: hasta esta fecha reactivarlo no cuesta nada. */
  reactivableUntil?: Date | null;
  /** Dónde termina el periodo pago actual (a esa fecha se aplicaría una desactivación). Nulo si el módulo es gratis. */
  periodEndsAt?: Date | null;
}

export interface QuoteRequirementDTO {
  plugin: PluginDTO;
  price: number;
  already_active: boolean;
}

export interface QuoteDiscountDTO {
  code: string;
  name: string;
  kind: 'percent' | 'fixed';
  /** percent: puntos básicos (1500 = 15 %). fixed: centavos. */
  value: number;
  /** Total descontado al mes, en centavos. */
  discount_cents: number;
  /** Meses que dura una vez canjeado; null = mientras el módulo siga activo. */
  duration_months: number | null;
  lines: Array<{ plugin_code: string; price: number; discount: number; final: number }>;
}

/** Lo que tienen en común la cotización de un módulo y la del carrito: total, descuento, IVA y prueba gratis. */
export interface QuoteTotals {
  total_monthly: number;
  /** Solo si se pidió con un código y el código vale. */
  discount?: QuoteDiscountDTO;
  /** Solo si se pidió con un código y NO vale (vencido, agotado, no aplica...). La cotización normal viene igual. */
  discount_error?: { code: string; message: string };
  /** Solo con descuento: lo que se pagaría al mes, sin IVA. */
  total_after_discount?: number;
  /** Los campos de abajo salen siempre que el servicio tenga política comercial (producción): IVA y prueba gratis. */
  vat_percent?: number;
  /** IVA mensual, sobre el total con descuento si lo hay. */
  vat_cents?: number;
  /** Lo que se pagaría al mes con IVA, pasada la prueba. */
  total_with_vat?: number;
  /** Prueba gratis de la organización. Ausente si todavía no ha empezado. */
  trial?: { active: boolean; ends_at: string; days_left: number };
  /** Lo que se paga HOY con IVA: 0 mientras dure la prueba. */
  due_today?: number;
}

export interface QuoteDTO extends QuoteTotals {
  plugin: PluginDTO;
  price: number;
  requires: QuoteRequirementDTO[];
}

export interface CartQuoteItemDTO {
  plugin: PluginDTO;
  price: number;
  /** `selected`: lo que se eligió; `required`: lo que arrastra y se activará también; `already_active`: ya lo tiene. */
  kind: 'selected' | 'required' | 'already_active';
  /** Para `required`: el módulo elegido que lo necesita. */
  required_by?: string;
}

export interface CartQuoteDTO extends QuoteTotals {
  items: CartQuoteItemDTO[];
  /** Códigos que no se pueden activar (no existen, son del núcleo o aún no están disponibles): no cuentan en el total. */
  invalid: { code: string; reason: 'not_found' | 'core' | 'not_available' }[];
  /** Dependencias que no se activan solas: hay que resolverlas antes de poder activar. */
  missing: string[];
}

export interface PluginCustomRequestDTO {
  id: string;
  organizationId: string;
  description: string;
  basedOnPluginIds: string[];
  status: 'requested' | 'quoted' | 'created' | 'rejected';
  resultingPluginId: string | null;
  quotedPriceCents: number | null;
  rejectionReason: string | null;
}

export interface RequestCustomPluginInput {
  organizationId: string;
  description: string;
  basedOnPluginCodes: string[];
}

export interface FulfillCustomPluginRequestInput {
  requestId: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl?: string | null;
  basedOnPluginId?: string | null;
}

// ---------------------------------------------------------------------------
// Business Profiles
// ---------------------------------------------------------------------------

export interface BusinessProfileDTO {
  code: string;
  name: string;
  description: string;
  icon: string;
  /** Fila traducible; `pending` significa que la org aún no decide. */
  status?: 'selected' | 'skipped';
}

export interface RecommendationPluginDTO {
  code: string;
  name: string;
  category: string;
  buildStatus: string;
  priceCents: number;
  currency: string;
}

export interface RecommendationRequirementDTO {
  code: string;
  alreadyActive: boolean;
}

export interface RecommendationItemDTO {
  plugin: RecommendationPluginDTO;
  recommendation: 'essential' | 'suggested';
  state: 'activatable' | 'already_active' | 'coming_soon' | 'blocked';
  alreadyActive: boolean;
  requires: RecommendationRequirementDTO[];
}

export interface BusinessProfileRecommendationsDTO {
  profile: { code: string; name: string };
  items: RecommendationItemDTO[];
  totalMonthlyCents: number;
}

export interface ChooseBusinessProfileInput {
  organizationId: string;
  userId: string;
  code: string | null;
  /** De dónde viene la decisión: alta o cambios posteriores desde Ajustes. */
  source?: 'onboarding' | 'settings';
  /** Para devolver el perfil ya traducido, igual que hace el GET. */
  locale?: string;
}

export interface BatchActivationResult {
  code: string;
  result: 'activated' | 'already_active' | 'not_available' | 'missing_dependencies' | 'not_found';
}
