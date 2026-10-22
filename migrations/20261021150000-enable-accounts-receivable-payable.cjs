const fs = require('fs');
const path = require('path');

/**
 * Tesorería / Cuentas por cobrar y por pagar (Fase 3): pasa `finance.accounts_receivable_payable` de
 * «en construcción/falta» a `disponible` y lo apunta al `treasury-service`.
 *
 * Por qué una migración y no solo la semilla: las filas ya existen en las bases creadas con
 * `20260830130000-seed-plugins.cjs` y esa migración no vuelve a correr.
 *
 * Dependencias: los cobros y pagos generan asientos, así que debe depender también de `finance.general_ledger`
 * (su arista inversa ya se quitó en `20261015110000-enable-general-ledger.cjs`, no se restaura). Los módulos
 * `is_core` no se añaden como aristas (se dan con la cuenta). Las traducciones se actualizan desde las semillas
 * en/en/fr.
 *
 * Idempotente: se puede correr dos veces sin duplicar aristas ni traducciones.
 */
const CODE = 'finance.accounts_receivable_payable';
const LOCALES = ['en', 'fr'];

const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();
    const modulos = seed('plugins-dependencias.json').modulos;
    const i18n = seed('plugins-i18n.json');

    const modulo = modulos.find((m) => m.id === CODE);
    if (!modulo) throw new Error(`La semilla no define el módulo ${CODE}`);

    const [row] = await sequelize.query('SELECT id FROM plugins WHERE code = :code', { replacements: { code: CODE }, type: QueryTypes.SELECT });
    if (!row) return;

    // La tabla `plugins` NO tiene columna `service` (qué servicio sirve el módulo es dato de la semilla y del gateway, no de la base):
    // una versión anterior de esta migración la actualizaba y fallaba en cualquier base real, rompiendo el arranque del servicio.
    await sequelize.query(
      "UPDATE plugins SET build_status = 'disponible', description = :description, updated_at = :now WHERE id = :id",
      { replacements: { id: row.id, description: modulo.description, now } },
    );

    // Asegura las aristas declaradas en la semilla (idempotente). Omite módulos is_core.
    for (const dependency of modulo.depends_on ?? []) {
      const [dep] = await sequelize.query('SELECT id, is_core FROM plugins WHERE code = :dependency', { replacements: { dependency }, type: QueryTypes.SELECT });
      if (!dep || dep.is_core) continue;
      await sequelize.query(
        'INSERT IGNORE INTO plugin_dependencies (plugin_id, depends_on_plugin_id, auto_activate) VALUES (:pluginId, :depId, 1)',
        { replacements: { pluginId: row.id, depId: dep.id } },
      );
    }

    for (const locale of LOCALES) {
      const tr = i18n?.[CODE]?.[locale];
      if (tr?.description) {
        await sequelize.query(
          'UPDATE plugin_translations SET description = :description, name = COALESCE(name, :name), updated_at = :now WHERE plugin_id = :pluginId AND locale = :locale',
          { replacements: { description: tr.description, name: tr.name ?? null, now, pluginId: row.id, locale } },
        );
      }
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    const now = new Date();
    await sequelize.query(
      "UPDATE plugins SET build_status = 'en_construccion', updated_at = :now WHERE code = :code",
      { replacements: { now, code: CODE } },
    );
  },
};
