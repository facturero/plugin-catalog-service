/**
 * Un módulo incluido en la plataforma (núcleo) no depende de nada vendible: las migraciones 20261010120000 y 20261010140000
 * borraron las aristas que APUNTAN a ellos, pero quedaron las que SALEN de ellos (p. ej. «sincronización offline → POS»).
 * Con esas aristas el catálogo los seguía mostrando como «los necesitan estos módulos» en el POS y con un «Requiere: POS»
 * propio, aunque nadie puede apagarlos ni comprarlos. Es idempotente.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE FROM plugin_dependencies WHERE plugin_id IN (SELECT id FROM plugins WHERE is_core = 1)',
    );
  },

  // Las aristas borradas no se restauran: un módulo del núcleo no tiene dependencias que recuperar.
  async down() {},
};
