import { OrganizationTrial } from '../../domain/trial';
import { Repositories } from '../../domain/repositories';
import { PricingPolicy } from '../pricing-policy';
import { UnitOfWork } from '../ports';

export interface TrialDTO {
  started_at: string;
  ends_at: string;
  active: boolean;
  days_left: number;
}

export interface SubscriptionDTO {
  /** null = la organización todavía no tiene prueba (su administrador no ha ingresado) o no hay prueba configurada. */
  trial: TrialDTO | null;
  /** IVA que se suma a los precios, en porcentaje (15 = 15 %). */
  vat_percent: number;
}

export function toTrialDTO(trial: OrganizationTrial, now: Date): TrialDTO {
  return {
    started_at: trial.startedAt.toISOString(),
    ends_at: trial.endsAt.toISOString(),
    active: trial.isActiveAt(now),
    days_left: trial.daysLeftAt(now),
  };
}

/**
 * Estado comercial de la organización: su prueba gratis y el IVA.
 *
 * La prueba arranca AQUÍ, la primera vez que su administrador (quien puede gestionar módulos) abre el CRM: el frontend
 * llama a este endpoint al cargar, así que equivale a «su primer ingreso». Si otra persona sin ese permiso lo consulta
 * antes, solo lee: no arranca nada. Arrancar es idempotente (dos ingresos a la vez crean una sola prueba) y nunca se
 * renueva: activar un módulo nuevo en el mes 2 no da otros meses.
 *
 * Las organizaciones que ya existían cuando se lanzó esto arrancan su prueba la primera vez que su administrador
 * ingrese DESPUÉS del lanzamiento, no desde que se crearon.
 */
export class GetSubscriptionUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly policy: PricingPolicy,
  ) {}

  async execute(input: {
    organizationId: string;
    userId: string | null;
    canManagePlugins: boolean;
    now?: Date;
  }): Promise<SubscriptionDTO> {
    const now = input.now ?? new Date();

    return this.uow.execute(async (repos: Repositories) => {
      let trial = await repos.organizationTrials.find(input.organizationId);

      if (!trial && input.canManagePlugins && this.policy.trialMonths > 0) {
        const fresh = OrganizationTrial.start({
          organizationId: input.organizationId,
          userId: input.userId,
          months: this.policy.trialMonths,
          now,
        });
        const created = await repos.organizationTrials.insertIfAbsent(fresh);
        if (created) {
          await repos.outbox.add({
            type: 'pricing.trial.started',
            aggregateType: 'trial',
            aggregateId: input.organizationId,
            payload: {
              targetId: input.organizationId,
              organizationId: input.organizationId,
              startedAt: fresh.startedAt,
              endsAt: fresh.endsAt,
              months: this.policy.trialMonths,
            },
            occurredAt: now,
          });
        }
        trial = await repos.organizationTrials.find(input.organizationId);
      }

      return {
        trial: trial ? toTrialDTO(trial, now) : null,
        vat_percent: this.policy.vatBps / 100,
      };
    });
  }
}
