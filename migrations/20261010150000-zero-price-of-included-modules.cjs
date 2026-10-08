/**
 * Lo que va incluido en la plataforma no se cobra: deja en 0 el precio de todo módulo del núcleo. Hacía falta porque los tres
 * módulos de 20261010140000 (sincronización del POS, documentos compartidos y métodos de pago) ya tenían precio puesto y el
 * catálogo los mostraba «Incluido» pero con su importe al lado. Es idempotente.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('UPDATE plugins SET price_cents = 0, updated_at = :now WHERE is_core = 1 AND price_cents <> 0', {
      replacements: { now: new Date() },
    });
  },

  // El precio anterior no se conserva: un módulo incluido no tiene precio al que volver.
  async down() {},
};
