import { randomUUID } from 'node:crypto';
import { InvalidCustomRequestStateError } from './errors';

export type BusinessProfilePluginRecommendation = 'essential' | 'suggested';
export type OrganizationProfileStatus = 'selected' | 'skipped';

export type BuildStatus = 'disponible' | 'en_construccion' | 'descontinuado';
export type ActivationSource = 'direct' | 'dependency';
export type OrganizationPluginStatus = 'active' | 'disabled';
export type CustomRequestStatus = 'requested' | 'quoted' | 'created' | 'rejected';

export interface PluginProps {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string | null;
  buildStatus: BuildStatus;
  priceCents: number;
  currency: string;
  isActive: boolean;
  isCore: boolean;
  createdForOrganizationId: string | null;
  basedOnPluginId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Plugin {
  private constructor(private props: PluginProps) {}

  static create(params: {
    id?: string;
    code: string;
    name: string;
    category: string;
    description: string;
    imageUrl?: string | null;
    buildStatus?: BuildStatus;
    priceCents: number;
    currency?: string;
    isActive?: boolean;
    isCore?: boolean;
    createdForOrganizationId?: string | null;
    basedOnPluginId?: string | null;
  }): Plugin {
    const now = new Date();
    return new Plugin({
      id: params.id ?? randomUUID(),
      code: params.code,
      name: params.name,
      category: params.category,
      description: params.description,
      imageUrl: params.imageUrl ?? null,
      buildStatus: params.buildStatus ?? 'disponible',
      priceCents: params.priceCents,
      currency: params.currency ?? 'USD',
      isActive: params.isActive ?? true,
      isCore: params.isCore ?? false,
      createdForOrganizationId: params.createdForOrganizationId ?? null,
      basedOnPluginId: params.basedOnPluginId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: PluginProps): Plugin {
    return new Plugin({ ...props });
  }

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get category(): string { return this.props.category; }
  get description(): string { return this.props.description; }
  get imageUrl(): string | null { return this.props.imageUrl; }
  get buildStatus(): BuildStatus { return this.props.buildStatus; }
  get priceCents(): number { return this.props.priceCents; }
  get currency(): string { return this.props.currency; }
  get isActive(): boolean { return this.props.isActive; }
  get isCore(): boolean { return this.props.isCore; }
  get createdForOrganizationId(): string | null { return this.props.createdForOrganizationId; }
  get basedOnPluginId(): string | null { return this.props.basedOnPluginId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  get isPublic(): boolean {
    return this.props.createdForOrganizationId === null;
  }

  get isBuyable(): boolean {
    return !this.props.isCore && this.props.buildStatus === 'disponible' && this.props.isActive;
  }

  isVisibleTo(organizationId: string | null): boolean {
    if (this.isPublic) return true;
    return this.props.createdForOrganizationId === organizationId;
  }

  toPersistence(): PluginProps {
    return { ...this.props };
  }
}

export interface PluginDependencyProps {
  pluginId: string;
  dependsOnPluginId: string;
  autoActivate: boolean;
}

export class PluginDependency {
  private constructor(private props: PluginDependencyProps) {}

  static create(params: { pluginId: string; dependsOnPluginId: string; autoActivate?: boolean }): PluginDependency {
    return new PluginDependency({
      pluginId: params.pluginId,
      dependsOnPluginId: params.dependsOnPluginId,
      autoActivate: params.autoActivate ?? true,
    });
  }

  static fromPersistence(props: PluginDependencyProps): PluginDependency {
    return new PluginDependency({ ...props });
  }

  get pluginId(): string { return this.props.pluginId; }
  get dependsOnPluginId(): string { return this.props.dependsOnPluginId; }
  get autoActivate(): boolean { return this.props.autoActivate; }

  toPersistence(): PluginDependencyProps {
    return { ...this.props };
  }
}

export interface OrganizationPluginProps {
  organizationId: string;
  pluginId: string;
  activationSource: ActivationSource;
  requiredByPluginId: string | null;
  status: OrganizationPluginStatus;
  activatedAt: Date;
  deactivatedAt: Date | null;
}

export class OrganizationPlugin {
  private constructor(private props: OrganizationPluginProps) {}

  static activateDirect(organizationId: string, pluginId: string): OrganizationPlugin {
    const now = new Date();
    return new OrganizationPlugin({
      organizationId,
      pluginId,
      activationSource: 'direct',
      requiredByPluginId: null,
      status: 'active',
      activatedAt: now,
      deactivatedAt: null,
    });
  }

  static activateAsDependency(organizationId: string, pluginId: string, requiredByPluginId: string): OrganizationPlugin {
    const now = new Date();
    return new OrganizationPlugin({
      organizationId,
      pluginId,
      activationSource: 'dependency',
      requiredByPluginId,
      status: 'active',
      activatedAt: now,
      deactivatedAt: null,
    });
  }

  static fromPersistence(props: OrganizationPluginProps): OrganizationPlugin {
    return new OrganizationPlugin({ ...props });
  }

  get organizationId(): string { return this.props.organizationId; }
  get pluginId(): string { return this.props.pluginId; }
  get activationSource(): ActivationSource { return this.props.activationSource; }
  get requiredByPluginId(): string | null { return this.props.requiredByPluginId; }
  get status(): OrganizationPluginStatus { return this.props.status; }
  get activatedAt(): Date { return this.props.activatedAt; }
  get deactivatedAt(): Date | null { return this.props.deactivatedAt; }

  get isActive(): boolean {
    return this.props.status === 'active';
  }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  deactivate(): void {
    this.props.status = 'disabled';
    this.props.deactivatedAt = new Date();
  }

  toPersistence(): OrganizationPluginProps {
    return { ...this.props };
  }
}

export interface PluginCustomRequestProps {
  id: string;
  organizationId: string;
  description: string;
  basedOnPluginIds: string[];
  status: CustomRequestStatus;
  resultingPluginId: string | null;
  quotedPriceCents: number | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PluginCustomRequest {
  private constructor(private props: PluginCustomRequestProps) {}

  static request(params: {
    id?: string;
    organizationId: string;
    description: string;
    basedOnPluginIds: string[];
  }): PluginCustomRequest {
    const now = new Date();
    return new PluginCustomRequest({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      description: params.description,
      basedOnPluginIds: [...params.basedOnPluginIds],
      status: 'requested',
      resultingPluginId: null,
      quotedPriceCents: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: PluginCustomRequestProps): PluginCustomRequest {
    return new PluginCustomRequest({ ...props, basedOnPluginIds: [...props.basedOnPluginIds] });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get description(): string { return this.props.description; }
  get basedOnPluginIds(): string[] { return [...this.props.basedOnPluginIds]; }
  get status(): CustomRequestStatus { return this.props.status; }
  get resultingPluginId(): string | null { return this.props.resultingPluginId; }
  get quotedPriceCents(): number | null { return this.props.quotedPriceCents; }
  get rejectionReason(): string | null { return this.props.rejectionReason; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  markQuoted(priceCents: number): void {
    if (this.props.status !== 'requested' && this.props.status !== 'quoted') {
      throw new InvalidCustomRequestStateError();
    }
    this.props.status = 'quoted';
    this.props.quotedPriceCents = priceCents;
    this.props.updatedAt = new Date();
  }

  fulfill(resultingPluginId: string): void {
    if (this.props.status !== 'requested' && this.props.status !== 'quoted') {
      throw new InvalidCustomRequestStateError();
    }
    this.props.status = 'created';
    this.props.resultingPluginId = resultingPluginId;
    this.props.updatedAt = new Date();
  }

  reject(reason: string): void {
    if (this.props.status === 'created' || this.props.status === 'rejected') {
      throw new InvalidCustomRequestStateError();
    }
    this.props.status = 'rejected';
    this.props.rejectionReason = reason;
    this.props.updatedAt = new Date();
  }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  toPersistence(): PluginCustomRequestProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Business Profiles
// ---------------------------------------------------------------------------

export interface BusinessProfileProps {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class BusinessProfile {
  private constructor(private props: BusinessProfileProps) {}

  static create(params: {
    code: string;
    name: string;
    description: string;
    icon?: string;
    sortOrder?: number;
    isActive?: boolean;
  }): BusinessProfile {
    const now = new Date();
    return new BusinessProfile({
      id: randomUUID(),
      code: params.code,
      name: params.name,
      description: params.description,
      icon: params.icon ?? 'mdi-storefront-outline',
      sortOrder: params.sortOrder ?? 0,
      isActive: params.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: BusinessProfileProps): BusinessProfile {
    return new BusinessProfile({ ...props });
  }

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get description(): string { return this.props.description; }
  get icon(): string { return this.props.icon; }
  get sortOrder(): number { return this.props.sortOrder; }
  get isActive(): boolean { return this.props.isActive; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  toPersistence(): BusinessProfileProps {
    return { ...this.props };
  }
}

export interface BusinessProfilePluginProps {
  businessProfileId: string;
  pluginId: string;
  recommendation: BusinessProfilePluginRecommendation;
  sortOrder: number;
}

export class BusinessProfilePlugin {
  private constructor(private props: BusinessProfilePluginProps) {}

  static create(params: {
    businessProfileId: string;
    pluginId: string;
    recommendation: BusinessProfilePluginRecommendation;
    sortOrder?: number;
  }): BusinessProfilePlugin {
    return new BusinessProfilePlugin({
      businessProfileId: params.businessProfileId,
      pluginId: params.pluginId,
      recommendation: params.recommendation,
      sortOrder: params.sortOrder ?? 0,
    });
  }

  static fromPersistence(props: BusinessProfilePluginProps): BusinessProfilePlugin {
    return new BusinessProfilePlugin({ ...props });
  }

  get businessProfileId(): string { return this.props.businessProfileId; }
  get pluginId(): string { return this.props.pluginId; }
  get recommendation(): BusinessProfilePluginRecommendation { return this.props.recommendation; }
  get sortOrder(): number { return this.props.sortOrder; }
  get isEssential(): boolean { return this.props.recommendation === 'essential'; }

  toPersistence(): BusinessProfilePluginProps {
    return { ...this.props };
  }
}

export interface OrganizationBusinessProfileProps {
  organizationId: string;
  businessProfileId: string | null;
  status: OrganizationProfileStatus;
  decidedByUserId: string | null;
  decidedAt: Date;
  updatedAt: Date;
}

export class OrganizationBusinessProfile {
  private constructor(private props: OrganizationBusinessProfileProps) {}

  static choose(
    organizationId: string,
    profileId: string,
    userId: string,
  ): OrganizationBusinessProfile {
    const now = new Date();
    return new OrganizationBusinessProfile({
      organizationId,
      businessProfileId: profileId,
      status: 'selected',
      decidedByUserId: userId,
      decidedAt: now,
      updatedAt: now,
    });
  }

  static skip(organizationId: string, userId: string): OrganizationBusinessProfile {
    const now = new Date();
    return new OrganizationBusinessProfile({
      organizationId,
      businessProfileId: null,
      status: 'skipped',
      decidedByUserId: userId,
      decidedAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: OrganizationBusinessProfileProps): OrganizationBusinessProfile {
    return new OrganizationBusinessProfile({ ...props });
  }

  get organizationId(): string { return this.props.organizationId; }
  get businessProfileId(): string | null { return this.props.businessProfileId; }
  get status(): OrganizationProfileStatus { return this.props.status; }
  get decidedByUserId(): string | null { return this.props.decidedByUserId; }
  get decidedAt(): Date { return this.props.decidedAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  get isPending(): boolean { return this.props.businessProfileId === null && this.props.status === 'selected'; }
  get hasProfile(): boolean { return this.props.status === 'selected' && this.props.businessProfileId !== null; }
  get wasSkipped(): boolean { return this.props.status === 'skipped'; }

  toPersistence(): OrganizationBusinessProfileProps {
    return { ...this.props };
  }
}
