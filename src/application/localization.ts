import { PluginTranslation } from '../domain/repositories';

/**
 * Idioma base del catálogo: es el que vive en la propia tabla `plugins` y el
 * que se sirve cuando no hay traducción para lo que pide el cliente.
 */
export const BASE_LOCALE = 'es';

/** Idiomas con traducciones cargadas por el seeder. */
export const SUPPORTED_LOCALES = ['es', 'en', 'fr'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resuelve el idioma a partir de la cabecera `Accept-Language`.
 *
 * Implementa lo justo de RFC 9110 para este caso: lista separada por comas con
 * `q` opcional, se ordena por preferencia y gana el primero que soportamos.
 * Se compara solo la subetiqueta primaria, así que 'en-US' y 'en-GB' resuelven
 * ambos a 'en'. Si no hay coincidencia, idioma base.
 */
export function resolveLocale(acceptLanguage: string | undefined | null): SupportedLocale {
  if (!acceptLanguage) return BASE_LOCALE;

  const candidates = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q };
    })
    .filter((c) => c.tag.length > 0 && c.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of candidates) {
    if (tag === '*') return BASE_LOCALE;
    const primary = tag.split('-')[0];
    if (isSupported(primary)) return primary;
  }
  return BASE_LOCALE;
}

/** Campos de texto de un plugin que se traducen. */
export interface LocalizedPluginText {
  name: string;
  category: string;
  description: string;
}

/**
 * Aplica la traducción si existe. El fallback es campo a campo y no por fila
 * entera: una traducción a medias muestra lo traducido y deja el resto en el
 * idioma base, en vez de descartarla completa.
 */
export function localizeText(
  base: LocalizedPluginText,
  translation: PluginTranslation | undefined,
): LocalizedPluginText {
  if (!translation) return base;
  return {
    name: translation.name || base.name,
    category: translation.category || base.category,
    description: translation.description || base.description,
  };
}
