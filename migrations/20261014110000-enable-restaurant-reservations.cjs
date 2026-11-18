const fs = require('fs');
const path = require('path');

/**
 * `restaurant.reservations` pasa de «en construcción» a disponible: el servicio ya recibe reservas del cliente final.
 *
 * Por qué una migración y no solo la semilla: la fila ya existe en las bases creadas con
 * `20261013130000-seed-restaurant-plugins.cjs` (en construcción, con la descripción provisional), y esa migración no vuelve a
 * correr. Sin esta, el módulo seguiría marcado «Pronto» y no se podría activar.
 *
 * El estado de construcción lo decide el catálogo, no el negocio; el precio y `is_active` sí los administra el negocio y no se
 * tocan. Idempotente: se puede correr de nuevo sin efecto.
 */
const CODE = 'restaurant.reservations';
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
    // En una base que aún no tiene el módulo (migración anterior sin aplicar) no hay nada que habilitar: la anterior lo inserta ya disponible.
    if (!row) return;

    await sequelize.query(
      "UPDATE plugins SET build_status = 'disponible', description = :description, updated_at = :now WHERE code = :code",
      { replacements: { description: modulo.description, now, code: CODE } },
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
    // Volver a «en construcción» no devuelve la descripción anterior (no vale la pena): solo cierra la puerta a activarlo.
    await queryInterface.sequelize.query(
      "UPDATE plugins SET build_status = 'en_construccion', updated_at = :now WHERE code = :code",
      { replacements: { now: new Date(), code: CODE } },
    );
  },
};
