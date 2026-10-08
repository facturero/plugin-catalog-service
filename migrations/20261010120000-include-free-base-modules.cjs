const fs = require('fs');
const path = require('path');

/**
 * Los módulos base que no se cobran (catálogo de productos, establecimientos, contactos, certificado .p12, ajustes de la
 * organización y notificaciones) pasan a ir INCLUIDOS en la plataforma: siempre activos para toda organización, sin poder
 * comprarse ni apagarse. Antes eran módulos «vendibles» de precio 0, y el usuario podía desactivarlos aunque no costaran
 * nada y todo lo demás dependiera de ellos.
 *
 * Qué módulos son lo dice `seed/plugins-dependencias.json` (`"included": true`). Esta migración lo aplica a una base ya
 * sembrada (en una base nueva el seed ya los crea como núcleo):
 *  - los marca `is_core`;
 *  - borra las aristas de dependencia que APUNTAN a ellos (lo incluido no se registra como dependencia: nadie lo activa);
 *  - borra sus filas en organization_plugins (el servicio los informa como activos para todas las organizaciones).
 * Es idempotente.
 */
function incluidos() {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'seed', 'plugins-dependencias.json'), 'utf8');
  return JSON.parse(raw).modulos.filter((m) => m.included === true).map((m) => m.id);
}

module.exports = {
  async up(queryInterface) {
    const codes = incluidos();
    if (codes.length === 0) return;
    const { QueryTypes } = queryInterface.sequelize;
    const rows = await queryInterface.sequelize.query('SELECT id FROM plugins WHERE code IN (:codes)', {
      replacements: { codes },
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
    const codes = incluidos();
    if (codes.length === 0) return;
    await queryInterface.sequelize.query('UPDATE plugins SET is_core = 0, updated_at = :now WHERE code IN (:codes)', {
      replacements: { codes, now: new Date() },
    });
  },
};
