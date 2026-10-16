const fs = require('fs');
const path = require('path');

/**
 * `finance.general_ledger` (contabilidad general) pasa de «en construcción» a disponible: accounting-service ya lleva el plan de
 * cuentas, los periodos y los asientos de partida doble (Fase 1.1 del plan ERP).
 *
 * Por qué una migración y no solo la semilla: la fila ya existe en las bases creadas con `20260830130000-seed-plugins.cjs`
 * (en construcción, con su descripción antigua) y esa migración no vuelve a correr.
 *
 * También se quita su dependencia de `finance.accounts_receivable_payable`: contabilidad no depende de cobros y pagos; al revés,
 * las cuentas por cobrar y pagar se apoyarán en ella. Con la arista, nadie podría activar la contabilidad hasta que existiera un
 * módulo que aún no se ha construido.
 *
 * El estado de construcción lo decide el catálogo, no el negocio; el precio y `is_active` sí los administra el negocio y no se
 * tocan. Idempotente: se puede correr de nuevo sin efecto.
 */
const CODE = 'finance.general_ledger';
const DEPENDENCY = 'finance.accounts_receivable_payable';
const LOCALES = ['en', 'fr'];

const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();

    const modulo = seed('plugins-dependencias.json').modulos.find((m) => m.id === CODE);
    if (!modulo) throw new Error(`La semilla no define el módulo ${CODE}`);
    const i18n = seed('plugins-i18n.json')[CODE];

    const [row] = await sequelize.query('SELECT id FROM plugins WHERE code = :code', {
      replacements: { code: CODE },
      type: QueryTypes.SELECT,
    });
    if (!row) return;

    await sequelize.query(
      "UPDATE plugins SET build_status = 'disponible', description = :description, updated_at = :now WHERE code = :code",
      { replacements: { description: modulo.description, now, code: CODE } },
    );

    await sequelize.query(
      `DELETE d FROM plugin_dependencies d
         JOIN plugins dep ON dep.id = d.depends_on_plugin_id
        WHERE d.plugin_id = :pluginId AND dep.code = :dependency`,
      { replacements: { pluginId: row.id, dependency: DEPENDENCY } },
    );

    for (const locale of LOCALES) {
      const tr = i18n?.[locale];
      if (!tr) throw new Error(`Falta la traducción ${locale} de ${CODE}`);
      await sequelize.query(
        'UPDATE plugin_translations SET description = :description, updated_at = :now WHERE plugin_id = :pluginId AND locale = :locale',
        { replacements: { description: tr.description, now, pluginId: row.id, locale } },
      );
    }
  },

  async down(queryInterface) {
    // Volver a «en construcción» cierra la puerta a activarlo; la arista y la descripción anteriores no se restauran.
    await queryInterface.sequelize.query(
      "UPDATE plugins SET build_status = 'en_construccion', updated_at = :now WHERE code = :code",
      { replacements: { now: new Date(), code: CODE } },
    );
  },
};
