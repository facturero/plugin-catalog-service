/**
 * La prueba gratis es de la ORGANIZACIÓN, no de cada módulo: arranca una sola vez, con el primer ingreso de su
 * administrador, y mientras dura todos los módulos disponibles se pueden activar sin pagar. Pasados los meses, cada
 * módulo activo se cobra a su precio mensual. Activar un módulo nuevo en el mes 2 NO le da otros 3 meses.
 */
export interface OrganizationTrialProps {
  organizationId: string;
  startedAt: Date;
  endsAt: Date;
  startedByUserId: string | null;
}

/** Suma meses de calendario en UTC (31 de enero + 1 mes = fin de febrero, nunca marzo). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export class OrganizationTrial {
  private constructor(private readonly props: OrganizationTrialProps) {}

  static start(params: { organizationId: string; userId: string | null; months: number; now?: Date }): OrganizationTrial {
    const startedAt = params.now ?? new Date();
    return new OrganizationTrial({
      organizationId: params.organizationId,
      startedAt,
      endsAt: addMonths(startedAt, params.months),
      startedByUserId: params.userId,
    });
  }

  static fromPersistence(props: OrganizationTrialProps): OrganizationTrial {
    return new OrganizationTrial({ ...props });
  }

  get organizationId(): string { return this.props.organizationId; }
  get startedAt(): Date { return this.props.startedAt; }
  get endsAt(): Date { return this.props.endsAt; }
  get startedByUserId(): string | null { return this.props.startedByUserId; }

  isActiveAt(now: Date = new Date()): boolean {
    return now >= this.props.startedAt && now < this.props.endsAt;
  }

  /** Días enteros que faltan (redondea hacia arriba: el último día cuenta como 1). 0 si ya terminó. */
  daysLeftAt(now: Date = new Date()): number {
    if (!this.isActiveAt(now)) return 0;
    return Math.ceil((this.props.endsAt.getTime() - now.getTime()) / 86_400_000);
  }
}
