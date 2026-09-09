import { BatchActivationResult } from '../dtos';
import { ActivatePluginUseCase } from './activate-plugin';

/**
 * Activación en lote, tolerante a fallos parciales: cada código se procesa de
 * forma independiente con el mismo caso de uso que el endpoint individual, y
 * un fallo no aborta el resto. Nunca devuelve error global: la pantalla enseña
 * qué entró y qué no. Reutilizable fuera del alta (la vista de módulos).
 */
export class ActivatePluginsBatchUseCase {
  constructor(
    private readonly activate: ActivatePluginUseCase,
  ) {}

  async execute(organizationId: string, codes: string[]): Promise<BatchActivationResult[]> {
    const results: BatchActivationResult[] = [];
    for (const code of codes) {
      try {
        await this.activate.execute(organizationId, code);
        results.push({ code, result: 'activated' });
      } catch (e) {
        const err = e as { code?: string };
        switch (err.code) {
          case 'PLUGIN_ALREADY_ACTIVE':
            results.push({ code, result: 'already_active' });
            break;
          case 'MISSING_DEPENDENCIES':
            results.push({ code, result: 'missing_dependencies' });
            break;
          case 'CORE_PLUGIN_NOT_CONFIGURABLE':
          case 'PLUGIN_NOT_AVAILABLE':
            results.push({ code, result: 'not_available' });
            break;
          case 'PLUGIN_NOT_FOUND':
            results.push({ code, result: 'not_found' });
            break;
          default:
            results.push({ code, result: 'not_available' });
            break;
        }
      }
    }
    return results;
  }
}