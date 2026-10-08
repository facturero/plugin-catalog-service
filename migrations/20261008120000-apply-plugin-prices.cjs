const fs = require('fs');
const path = require('path');

/**
 * Pone precio a los módulos a partir de `seed/plugins-precios.json` (USD al mes, sin IVA, por organización).
 *
 * Hasta hoy todos nacían con `price_cents = 0` (la migración que siembra el catálogo nunca toca precios). Esta SOLO
 * cambia los que siguen en 0: si alguien ya fijó un precio a mano en la base, no se pisa. Los módulos del núcleo
 * (`is_core`) no se venden y no se tocan. Es idempotente: correrla dos veces no cambia nada la segunda vez.
 */
function cargarPrecios() {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'seed', 'plugins-precios.json'), 'utf8');
  return JSON.parse(raw).precios_cents;
}

module.exports = {
  async up(queryInterface) {
    const precios = cargarPrecios();
    const now = new Date();
    for (const [code, cents] of Object.entries(precios)) {
      if (cents === 0) continue; // ya está en 0: nada que hacer
      await queryInterface.sequelize.query(
        'UPDATE plugins SET price_cents = :cents, updated_at = :now WHERE code = :code AND price_cents = 0 AND is_core = 0',
        { replacements: { cents, now, code } },
      );
    }
  },

  async down(queryInterface) {
    // Solo revierte lo que sigue valiendo exactamente lo que esta migración puso.
    const precios = cargarPrecios();
    for (const [code, cents] of Object.entries(precios)) {
      if (cents === 0) continue;
      await queryInterface.sequelize.query(
        'UPDATE plugins SET price_cents = 0, updated_at = :now WHERE code = :code AND price_cents = :cents',
        { replacements: { cents, now: new Date(), code } },
      );
    }
  },
};
