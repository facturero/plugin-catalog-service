const fs = require('fs');
const path = require('path');

/**
 * Quita del catálogo cuatro módulos que no eran un producto aparte:
 *  - pos.cash_sessions (cajas y turnos) y pos.discounts_promotions (descuentos al cobrar): son funciones del propio POS, que ya
 *    las trae. Venderlas por separado cobraba dos veces algo que va dentro de la caja. Su descripción pasa a pos.core.
 *  - inventory.purchase_orders: duplicaba purchasing.purchase_orders («vista de inventario» de las mismas órdenes de compra).
 *  - finance.multicurrency: ninguna ruta ni pantalla dependía de él (el producto guarda siempre su moneda y el importe en
 *    centavos), así que se vendía algo que no bloqueaba nada.
 * Borra el módulo y todo lo que lo referencia (traducciones, aristas en ambos sentidos, activaciones, carrito, perfiles y
 * descuentos acotados a él). Las organizaciones que lo tenían activo no pierden nada: la función ya va en pos.core. Es idempotente.
 */
const CODES = ['pos.cash_sessions', 'pos.discounts_promotions', 'inventory.purchase_orders', 'finance.multicurrency'];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();

    const rows = await sequelize.query('SELECT id FROM plugins WHERE code IN (:codes)', {
      replacements: { codes: CODES },
      type: QueryTypes.SELECT,
    });
    const ids = rows.map((r) => r.id);

    if (ids.length > 0) {
      const byIds = { replacements: { ids } };
      await sequelize.query('DELETE FROM organization_cart_items WHERE plugin_id IN (:ids)', byIds);
      await sequelize.query('DELETE FROM business_profile_plugins WHERE plugin_id IN (:ids)', byIds);
      await sequelize.query('DELETE FROM plugin_translations WHERE plugin_id IN (:ids)', byIds);
      await sequelize.query('DELETE FROM plugin_dependencies WHERE plugin_id IN (:ids) OR depends_on_plugin_id IN (:ids)', byIds);
      await sequelize.query('UPDATE organization_plugins SET required_by_plugin_id = NULL WHERE required_by_plugin_id IN (:ids)', byIds);
      await sequelize.query('DELETE FROM organization_plugins WHERE plugin_id IN (:ids)', byIds);
      await sequelize.query('UPDATE plugins SET based_on_plugin_id = NULL WHERE based_on_plugin_id IN (:ids)', byIds);
      await sequelize.query('DELETE FROM plugins WHERE id IN (:ids)', byIds);
    }
    await sequelize.query('DELETE FROM discount_plugins WHERE plugin_code IN (:codes)', { replacements: { codes: CODES } });

    // pos.core absorbe la descripción de lo que dejó de venderse aparte; el texto sale del seed para no duplicarlo aquí.
    const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));
    const core = seed('plugins-dependencias.json').modulos.find((m) => m.id === 'pos.core');
    const i18n = seed('plugins-i18n.json')['pos.core'];
    const [pos] = await sequelize.query("SELECT id FROM plugins WHERE code = 'pos.core'", { type: QueryTypes.SELECT });
    if (pos && core) {
      await sequelize.query('UPDATE plugins SET description = :description, updated_at = :now WHERE id = :id', {
        replacements: { description: core.description, now, id: pos.id },
      });
      for (const locale of ['en', 'fr']) {
        if (!i18n?.[locale]) continue;
        await sequelize.query(
          'UPDATE plugin_translations SET description = :description WHERE plugin_id = :id AND locale = :locale',
          { replacements: { description: i18n[locale].description, id: pos.id, locale } },
        );
      }
    }
  },

  // Volver a vender estos módulos es una decisión de producto, no un deshacer: no se restauran filas.
  async down() {},
};
