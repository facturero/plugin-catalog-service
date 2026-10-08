import { randomUUID } from 'node:crypto';
import { DiscountRejectedError, ValidationError } from './errors';

/**
 * Descuentos sobre el precio de los módulos.
 *
 * Un descuento se canjea con un CÓDIGO (cupón) y rebaja el precio mensual de lo que se activa. Reglas, todas
 * deliberadas:
 *  - `percent`: un porcentaje (en puntos básicos: 1500 = 15 %). `fixed`: una cantidad en centavos sobre el subtotal
 *    elegible, que nunca baja de cero.
 *  - Alcance: todos los módulos, o una lista de ellos. Los módulos del núcleo y los ya activos no cuestan nada, así que
 *    tampoco se descuentan.
 *  - Vigencia (desde/hasta), tope global de canjes, tope por organización (1 por defecto) y, opcionalmente, privado de
 *    una sola organización.
 *  - `durationMonths`: cuántos meses dura el descuento desde que se canjea; null = mientras el módulo siga activo.
 *  - No se acumulan: una activación admite un solo código.
 */
export type DiscountKind = 'percent' | 'fixed';

/** En un descuento de monto fijo: se resta a CADA módulo (lo normal) o una sola vez al total. En porcentaje es lo mismo. */
export type FixedAppliesTo = 'plugin' | 'total';

export interface DiscountProps {
  id: string;
  code: string;
  name: string;
  kind: DiscountKind;
  /** percent: puntos básicos (1..10000). fixed: centavos (>0). */
  value: number;
  fixedAppliesTo: FixedAppliesTo;
  /** Códigos de los módulos a los que aplica. Vacío = todos. */
  pluginCodes: string[];
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  perOrganizationLimit: number;
  organizationId: string | null;
  durationMonths: number | null;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Una línea de la cotización a la que se le puede aplicar el descuento. */
export interface PriceLine {
  pluginCode: string;
  /** Precio de lista mensual, en centavos. */
  priceCents: number;
}

export interface DiscountResult {
  /** Descuento por módulo (solo los que lo reciben). */
  lines: Array<{ pluginCode: string; priceCents: number; discountCents: number; finalCents: number }>;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export type DiscountRejection =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | 'already_redeemed'
  | 'other_organization'
  | 'not_applicable';

export class Discount {
  private constructor(private props: DiscountProps) {}

  static create(params: {
    code: string;
    name: string;
    kind: DiscountKind;
    value: number;
    fixedAppliesTo?: FixedAppliesTo;
    pluginCodes?: string[];
    validFrom?: Date | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
    perOrganizationLimit?: number;
    organizationId?: string | null;
    durationMonths?: number | null;
    createdByUserId?: string | null;
  }): Discount {
    const now = new Date();
    const discount = new Discount({
      id: randomUUID(),
      code: Discount.normalizeCode(params.code),
      name: params.name.trim(),
      kind: params.kind,
      value: params.value,
      fixedAppliesTo: params.fixedAppliesTo ?? 'plugin',
      pluginCodes: [...new Set(params.pluginCodes ?? [])],
      validFrom: params.validFrom ?? null,
      validUntil: params.validUntil ?? null,
      maxRedemptions: params.maxRedemptions ?? null,
      redemptionCount: 0,
      perOrganizationLimit: params.perOrganizationLimit ?? 1,
      organizationId: params.organizationId ?? null,
      durationMonths: params.durationMonths ?? null,
      isActive: true,
      createdByUserId: params.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    discount.assertValid();
    return discount;
  }

  static fromPersistence(props: DiscountProps): Discount {
    return new Discount({ ...props, pluginCodes: [...props.pluginCodes] });
  }

  /** Los códigos se comparan sin importar mayúsculas ni espacios alrededor. */
  static normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get kind(): DiscountKind { return this.props.kind; }
  get value(): number { return this.props.value; }
  get fixedAppliesTo(): FixedAppliesTo { return this.props.fixedAppliesTo; }
  get pluginCodes(): string[] { return [...this.props.pluginCodes]; }
  get validFrom(): Date | null { return this.props.validFrom; }
  get validUntil(): Date | null { return this.props.validUntil; }
  get maxRedemptions(): number | null { return this.props.maxRedemptions; }
  get redemptionCount(): number { return this.props.redemptionCount; }
  get perOrganizationLimit(): number { return this.props.perOrganizationLimit; }
  get organizationId(): string | null { return this.props.organizationId; }
  get durationMonths(): number | null { return this.props.durationMonths; }
  get isActive(): boolean { return this.props.isActive; }
  get createdByUserId(): string | null { return this.props.createdByUserId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  toJSON(): DiscountProps {
    return { ...this.props, pluginCodes: [...this.props.pluginCodes] };
  }

  /** Cambia lo que se puede cambiar de un descuento ya creado. El código, el tipo y el valor NO: ya hay quien los vio. */
  update(changes: {
    name?: string;
    validFrom?: Date | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
    perOrganizationLimit?: number;
  }): void {
    if (changes.name !== undefined) this.props.name = changes.name.trim();
    if (changes.validFrom !== undefined) this.props.validFrom = changes.validFrom;
    if (changes.validUntil !== undefined) this.props.validUntil = changes.validUntil;
    if (changes.maxRedemptions !== undefined) this.props.maxRedemptions = changes.maxRedemptions;
    if (changes.perOrganizationLimit !== undefined) this.props.perOrganizationLimit = changes.perOrganizationLimit;
    this.props.updatedAt = new Date();
    this.assertValid();
  }

  deactivate(): void {
    this.props.isActive = false;
    this.props.updatedAt = new Date();
  }

  activate(): void {
    this.props.isActive = true;
    this.props.updatedAt = new Date();
  }

  registerRedemption(): void {
    this.props.redemptionCount += 1;
    this.props.updatedAt = new Date();
  }

  /** Por qué NO se puede usar ahora, o null si se puede. `redeemedByOrganization`: veces que esa organización ya lo canjeó. */
  rejectionFor(params: {
    organizationId: string;
    redeemedByOrganization: number;
    now?: Date;
  }): DiscountRejection | null {
    const now = params.now ?? new Date();
    if (!this.props.isActive) return 'inactive';
    if (this.props.organizationId && this.props.organizationId !== params.organizationId) return 'other_organization';
    if (this.props.validFrom && now < this.props.validFrom) return 'not_started';
    if (this.props.validUntil && now > this.props.validUntil) return 'expired';
    if (this.props.maxRedemptions !== null && this.props.redemptionCount >= this.props.maxRedemptions) return 'exhausted';
    if (params.redeemedByOrganization >= this.props.perOrganizationLimit) return 'already_redeemed';
    return null;
  }

  /** ¿Este descuento alcanza al módulo? Lista vacía = todos. */
  appliesTo(pluginCode: string): boolean {
    return this.props.pluginCodes.length === 0 || this.props.pluginCodes.includes(pluginCode);
  }

  /**
   * Calcula el descuento sobre las líneas que se van a pagar. Solo entran las que el descuento alcanza y que cuestan
   * algo. Reparte en enteros: nunca sobran ni faltan centavos (el resto va a la línea más cara), y el total descontado
   * jamás supera el subtotal elegible.
   */
  compute(lines: PriceLine[]): DiscountResult {
    const eligible = lines.filter((l) => l.priceCents > 0 && this.appliesTo(l.pluginCode));
    const subtotal = eligible.reduce((sum, l) => sum + l.priceCents, 0);

    if (subtotal === 0) {
      throw new DiscountRejectedError('not_applicable');
    }

    // Monto fijo POR MÓDULO: cada línea elegible baja `value` (sin pasar de su propio precio). Es lo que se entiende por
    // «$2 menos al mes a cada módulo». Se calcula línea por línea, así que no hay reparto que redondear.
    if (this.props.kind === 'fixed' && this.props.fixedAppliesTo === 'plugin') {
      const perLine = eligible.map((l) => ({
        pluginCode: l.pluginCode,
        priceCents: l.priceCents,
        discountCents: Math.min(this.props.value, l.priceCents),
        finalCents: l.priceCents - Math.min(this.props.value, l.priceCents),
      }));
      const total = perLine.reduce((sum, l) => sum + l.discountCents, 0);
      return {
        lines: perLine,
        subtotalCents: subtotal,
        discountCents: total,
        totalCents: lines.reduce((sum, l) => sum + l.priceCents, 0) - total,
      };
    }

    const wanted =
      this.props.kind === 'percent'
        ? Math.floor((subtotal * this.props.value) / 10000)
        : Math.min(this.props.value, subtotal);

    // Reparto proporcional por el método del mayor resto: cada línea recibe el entero de su parte exacta y los centavos
    // que sobran van, de uno en uno, a las líneas con la fracción más grande. Así la suma es EXACTA y ninguna línea
    // recibe más descuento que su propio precio (repartir todo el sobrante a la línea más cara podía dejarla en negativo).
    const exact = eligible.map((l) => (wanted * l.priceCents) / subtotal);
    const shares = exact.map((x) => Math.floor(x));
    let remainder = wanted - shares.reduce((a, b) => a + b, 0);
    const byFraction = exact
      .map((x, i) => ({ i, fraction: x - Math.floor(x) }))
      .sort((p, q) => q.fraction - p.fraction || eligible[q.i].priceCents - eligible[p.i].priceCents);
    for (const { i } of byFraction) {
      if (remainder === 0) break;
      if (shares[i] < eligible[i].priceCents) {
        shares[i] += 1;
        remainder -= 1;
      }
    }

    const resultLines = eligible.map((l, i) => ({
      pluginCode: l.pluginCode,
      priceCents: l.priceCents,
      discountCents: shares[i],
      finalCents: l.priceCents - shares[i],
    }));

    const totalList = lines.reduce((sum, l) => sum + l.priceCents, 0);
    return {
      lines: resultLines,
      subtotalCents: subtotal,
      discountCents: wanted,
      totalCents: totalList - wanted,
    };
  }

  private assertValid(): void {
    const details: Array<{ field: string; message: string }> = [];
    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(this.props.code)) {
      details.push({ field: 'code', message: 'El código lleva de 3 a 40 letras, números, guiones o guiones bajos.' });
    }
    if (!this.props.name) details.push({ field: 'name', message: 'El nombre es obligatorio.' });
    if (this.props.kind === 'percent') {
      if (!Number.isInteger(this.props.value) || this.props.value < 1 || this.props.value > 10000) {
        details.push({ field: 'value', message: 'El porcentaje va de 0,01 % a 100 % (en puntos básicos, 1 a 10000).' });
      }
    } else if (!Number.isInteger(this.props.value) || this.props.value < 1) {
      details.push({ field: 'value', message: 'El monto fijo debe ser un entero de centavos mayor que cero.' });
    }
    if (this.props.validFrom && this.props.validUntil && this.props.validUntil <= this.props.validFrom) {
      details.push({ field: 'validUntil', message: 'La fecha final debe ser posterior a la inicial.' });
    }
    if (this.props.maxRedemptions !== null && (!Number.isInteger(this.props.maxRedemptions) || this.props.maxRedemptions < 1)) {
      details.push({ field: 'maxRedemptions', message: 'El tope de canjes debe ser un entero mayor que cero (o vacío).' });
    }
    if (!Number.isInteger(this.props.perOrganizationLimit) || this.props.perOrganizationLimit < 1) {
      details.push({ field: 'perOrganizationLimit', message: 'El tope por organización debe ser un entero mayor que cero.' });
    }
    if (this.props.durationMonths !== null && (!Number.isInteger(this.props.durationMonths) || this.props.durationMonths < 1)) {
      details.push({ field: 'durationMonths', message: 'La duración debe ser un entero de meses mayor que cero (o vacía).' });
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}
