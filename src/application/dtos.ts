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
  activationSource: 'direct' | 'dependency';
  requiredByPluginId: string | null;
  status: 'active' | 'disabled';
  activatedAt: Date;
  deactivatedAt: Date | null;
}

export interface QuoteRequirementDTO {
  plugin: PluginDTO;
  price: number;
  already_active: boolean;
}

export interface QuoteDTO {
  plugin: PluginDTO;
  price: number;
  requires: QuoteRequirementDTO[];
  total_monthly: number;
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
