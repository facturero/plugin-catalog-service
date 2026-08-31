import { describe, expect, it } from 'vitest';
import { GetCatalogUseCase } from '../application/use-cases/get-catalog';
import { resolveLocale } from '../application/localization';
import type { PluginTranslation } from '../domain/repositories';
import { createInMemoryUow, createPlugin } from './helpers';

describe('resolveLocale', () => {
  it('cae al idioma base cuando no hay cabecera', () => {
    expect(resolveLocale(undefined)).toBe('es');
    expect(resolveLocale(null)).toBe('es');
    expect(resolveLocale('')).toBe('es');
  });

  it('acepta una etiqueta simple soportada', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('fr')).toBe('fr');
  });

  it('ignora la subetiqueta de región', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('fr-CA')).toBe('fr');
  });

  it('respeta el factor de calidad y no el orden textual', () => {
    expect(resolveLocale('de;q=0.9, fr;q=1.0')).toBe('fr');
    expect(resolveLocale('en;q=0.2, fr;q=0.8')).toBe('fr');
  });

  it('salta los idiomas que no soportamos', () => {
    expect(resolveLocale('de-DE, it;q=0.9, en;q=0.5')).toBe('en');
  });

  it('cae al idioma base con un comodín o con basura', () => {
    expect(resolveLocale('*')).toBe('es');
    expect(resolveLocale('xx-YY')).toBe('es');
  });

  it('descarta los idiomas con q=0 (rechazo explícito del cliente)', () => {
    expect(resolveLocale('en;q=0, fr;q=0.5')).toBe('fr');
  });
});

describe('catálogo traducido', () => {
  async function seedWorld() {
    const uow = createInMemoryUow();
    const plugin = createPlugin({
      code: 'crm.contacts',
      name: 'Gestion de contactos',
      category: 'Ventas y CRM',
      description: 'Guarda los clientes de la organizacion.',
    });
    await uow.repos.plugins.save(plugin);

    const internals = (uow.repos as unknown as {
      __internals: { translations: Map<string, PluginTranslation> };
    }).__internals;
    internals.translations.set(`en|${plugin.id}`, {
      pluginId: plugin.id,
      name: 'Contact management',
      category: 'Sales and CRM',
      description: 'Stores the organization customers.',
    });

    return { uow, plugin };
  }

  function catalogUseCase(uow: ReturnType<typeof createInMemoryUow>) {
    return new GetCatalogUseCase(
      uow.repos.plugins,
      uow.repos.dependencies,
      uow.repos.organizationPlugins,
      uow.repos.translations,
    );
  }

  it('devuelve el idioma base cuando no se pide otro', async () => {
    const { uow } = await seedWorld();
    const [row] = await catalogUseCase(uow).execute('org-1');
    expect(row.name).toBe('Gestion de contactos');
    expect(row.category).toBe('Ventas y CRM');
  });

  it('traduce nombre, categoría y descripción al idioma pedido', async () => {
    const { uow } = await seedWorld();
    const [row] = await catalogUseCase(uow).execute('org-1', 'en');
    expect(row.name).toBe('Contact management');
    expect(row.category).toBe('Sales and CRM');
    expect(row.description).toBe('Stores the organization customers.');
  });

  it('cae al idioma base cuando el idioma pedido no tiene traducción', async () => {
    const { uow } = await seedWorld();
    const [row] = await catalogUseCase(uow).execute('org-1', 'fr');
    expect(row.name).toBe('Gestion de contactos');
  });

  it('no altera el código del plugin, que es identidad y no texto', async () => {
    const { uow } = await seedWorld();
    const [row] = await catalogUseCase(uow).execute('org-1', 'en');
    expect(row.code).toBe('crm.contacts');
  });
});
