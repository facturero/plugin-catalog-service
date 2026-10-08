/**
 * Segunda tanda de módulos que pasan a ir INCLUIDOS (ver 20261010120000): no son una función que el cliente elija, sino
 * capacidades que el producto necesita para funcionar, así que ni se venden ni se apagan.
 *  - pos.offline_sync: la sincronización online/offline es cómo funciona la caja (venta local que se sube sola al haber red).
 *  - comm.shared_documents: el repositorio donde el sistema guarda los PDF/XML de los comprobantes y demás adjuntos.
 *  - pos.payment_methods: toda venta se registra con una forma de pago (efectivo, tarjeta, transferencia, combinadas).
 * Hace lo mismo que la anterior para estos códigos: los marca \`is_core\`, borra las aristas de dependencia que apuntan a ellos
 * y sus filas en organization_plugins (el servicio los informa como activos). Es idempotente.
 */
const CODES = ['pos.offline_sync', 'comm.shared_documents', 'pos.payment_methods'];

module.exports = {
  async up(queryInterface) {
    const { QueryTypes } = queryInterface.sequelize;
    const rows = await queryInterface.sequelize.query('SELECT id FROM plugins WHERE code IN (:codes)', {
      replacements: { codes: CODES },
      type: QueryTypes.SELECT,
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;

    await queryInterface.sequelize.query('UPDATE plugins SET is_core = 1, updated_at = :now WHERE id IN (:ids)', {
      replacements: { ids, now: new Date() },
    });
    await queryInterface.sequelize.query('DELETE FROM plugin_dependencies WHERE depends_on_plugin_id IN (:ids)', {
      replacements: { ids },
    });
    await queryInterface.sequelize.query('DELETE FROM organization_plugins WHERE plugin_id IN (:ids)', {
      replacements: { ids },
    });
  },

  // No se restauran las aristas ni las filas borradas: volver a venderlos es una decisión de producto, no un deshacer.
  async down(queryInterface) {
    await queryInterface.sequelize.query('UPDATE plugins SET is_core = 0, updated_at = :now WHERE code IN (:codes)', {
      replacements: { codes: CODES, now: new Date() },
    });
  },
};
