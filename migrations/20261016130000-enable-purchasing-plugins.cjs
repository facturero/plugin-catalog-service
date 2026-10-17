const fs = require('fs');
const path = require('path');

/**
 * Compras, Fase 2.1 del plan ERP: `inventory.suppliers` (proveedores) y `purchasing.purchase_orders` (órdenes de compra) pasan de
 * «en construcción» a disponibles: purchasing-service ya los sirve.
 *
 * Por qué una migración y no solo la semilla: las filas ya existen en las bases creadas con `20260830130000-seed-plugins.cjs`
 * (en construcción, con su descripción antigua) y esa migración no vuelve a correr.
 *
 * Dependencias: la orden de compra deja de exigir `purchasing.quote_comparison` (que a su vez exige las solicitudes de compra): la
 * comparación de cotizaciones y las solicitudes son pasos OPCIONALES que vienen después; con esa arista nadie podría activar las
 * órdenes hasta que existieran. Pasa a depender de lo que de verdad usa: proveedores y bodegas.
 *
 * El estado de construcción lo decide el catálogo, no el negocio; el precio y `is_active` sí los administra el negocio y no se
 * tocan. Idempotente: se puede correr de nuevo sin efecto.
 */
const CODES = ['inventory.suppliers', 'purchasing.purchase_orders'];
const OLD_DEPENDENCY = { 'purchasing.purchase_orders': 'purchasing.quote_comparison' };
const NEW_DEPENDENCIES = { 'purchasing.purchase_orders': ['inventory.suppliers', 'inventory.warehouses'] };
const LOCALES = ['en', 'fr'];

const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();
    const modulos = seed('plugins-dependencias.json').modulos;
    const i18n = seed('plugins-i18n.json');

    for (const code of CODES) {
      const modulo = modulos.find((m) => m.id === code);
      if (!modulo) throw new Error(`La semilla no define el módulo ${code}`);

      const [row] = await sequelize.query('SELECT id FROM plugins WHERE code = :code', { replacements: { code }, type: QueryTypes.SELECT });
      if (!row) continue;

      await sequelize.query(
        "UPDATE plugins SET build_status = 'disponible', description = :description, updated_at = :now WHERE code = :code",
        { replacements: { description: modulo.description, now, code } },
      );

      const old = OLD_DEPENDENCY[code];
      if (old) {
        await sequelize.query(
          `DELETE d FROM plugin_dependencies d
             JOIN plugins dep ON dep.id = d.depends_on_plugin_id
            WHERE d.plugin_id = :pluginId AND dep.code = :dependency`,
          { replacements: { pluginId: row.id, dependency: old } },
        );
      }

      for (const dependency of NEW_DEPENDENCIES[code] ?? []) {
        // Los módulos incluidos (is_core) no son aristas: se dan con la cuenta, no se activan.
        const [dep] = await sequelize.query('SELECT id, is_core FROM plugins WHERE code = :dependency', { replacements: { dependency }, type: QueryTypes.SELECT });
        if (!dep || dep.is_core) continue;
        await sequelize.query(
          'INSERT IGNORE INTO plugin_dependencies (plugin_id, depends_on_plugin_id, auto_activate) VALUES (:pluginId, :depId, 1)',
          { replacements: { pluginId: row.id, depId: dep.id } },
        );
      }

      for (const locale of LOCALES) {
        const tr = i18n?.[code]?.[locale];
        if (!tr) throw new Error(`Falta la traducción ${locale} de ${code}`);
        await sequelize.query(
          'UPDATE plugin_translations SET description = :description, updated_at = :now WHERE plugin_id = :pluginId AND locale = :locale',
          { replacements: { description: tr.description, now, pluginId: row.id, locale } },
        );
      }
    }
  },

  async down(queryInterface) {
    // Volver a «en construcción» cierra la puerta a activarlos; las aristas y descripciones anteriores no se restauran.
    await queryInterface.sequelize.query(
      "UPDATE plugins SET build_status = 'en_construccion', updated_at = :now WHERE code IN (:codes)",
      { replacements: { now: new Date(), codes: CODES } },
    );
  },
};
