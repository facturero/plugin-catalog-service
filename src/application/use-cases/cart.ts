import { UnitOfWork } from '../ports';
import { CartRepository, PluginRepository } from '../../domain/repositories';
import {
  CorePluginNotConfigurableError,
  PluginAlreadyActiveError,
  PluginNotAvailableError,
  PluginNotFoundError,
  PluginNotVisibleToOrganizationError,
} from '../../domain/errors';

export interface CartItemDTO {
  code: string;
  addedAt: Date;
  addedByUserId: string | null;
}

/**
 * El carrito guardado de la organización: lo que alguien dejó pendiente de activar. Está en el servidor para que no se
 * pierda al recargar ni al cambiar de equipo, y para que lo vea cualquier administrador de la organización.
 */
export class GetCartUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly plugins: PluginRepository,
  ) {}

  async execute(organizationId: string): Promise<CartItemDTO[]> {
    const items = await this.carts.list(organizationId);
    const out: CartItemDTO[] = [];
    for (const item of items) {
      const plugin = await this.plugins.findById(item.pluginId);
      if (plugin) out.push({ code: plugin.code, addedAt: item.addedAt, addedByUserId: item.addedByUserId });
    }
    return out;
  }
}

export class AddToCartUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  /** Agregar es idempotente: repetirlo no cambia nada ni deja otro rastro. */
  async execute(organizationId: string, pluginCode: string, userId: string | null): Promise<CartItemDTO[]> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();
      if (!plugin.isVisibleTo(organizationId)) throw new PluginNotVisibleToOrganizationError();
      if (plugin.isCore) throw new CorePluginNotConfigurableError(plugin.code);
      if (!plugin.isBuyable) throw new PluginNotAvailableError(plugin.buildStatus);
      if ((await repos.organizationPlugins.find(organizationId, plugin.id))?.status === 'active') {
        throw new PluginAlreadyActiveError();
      }

      const added = await repos.carts.add({ organizationId, pluginId: plugin.id, addedByUserId: userId, addedAt: new Date() });
      if (added) {
        await repos.outbox.add({
          type: 'pricing.cart.item_added',
          aggregateType: 'cart',
          aggregateId: organizationId,
          payload: { organizationId, pluginId: plugin.id, code: plugin.code },
          occurredAt: new Date(),
        });
      }
      return this.snapshot(repos, organizationId);
    });
  }

  private async snapshot(
    repos: { carts: CartRepository; plugins: PluginRepository },
    organizationId: string,
  ): Promise<CartItemDTO[]> {
    return new GetCartUseCase(repos.carts, repos.plugins).execute(organizationId);
  }
}

export class RemoveFromCartUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  /** Quitar lo que no estaba no es un error: el carrito queda igual que antes. */
  async execute(organizationId: string, pluginCode: string): Promise<CartItemDTO[]> {
    return this.uow.execute(async (repos) => {
      const plugin = await repos.plugins.findByCode(pluginCode);
      if (!plugin) throw new PluginNotFoundError();

      const removed = await repos.carts.remove(organizationId, plugin.id);
      if (removed) {
        await repos.outbox.add({
          type: 'pricing.cart.item_removed',
          aggregateType: 'cart',
          aggregateId: organizationId,
          payload: { organizationId, pluginId: plugin.id, code: plugin.code },
          occurredAt: new Date(),
        });
      }
      return new GetCartUseCase(repos.carts, repos.plugins).execute(organizationId);
    });
  }
}

export class ClearCartUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string): Promise<void> {
    await this.uow.execute(async (repos) => {
      const removed = await repos.carts.clear(organizationId);
      if (removed > 0) {
        await repos.outbox.add({
          type: 'pricing.cart.cleared',
          aggregateType: 'cart',
          aggregateId: organizationId,
          payload: { organizationId, items: removed },
          occurredAt: new Date(),
        });
      }
    });
  }
}
