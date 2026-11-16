/**
 * Mensajería al estilo Slack (`comm.internal_chat`) queda INCLUIDA en la plataforma (decisión del dueño, 2026-11-14): plugin del
 * núcleo, gratis y siempre activo para toda organización, sin fila en `organization_plugins` (ver get-organization-plugins.ts). Así el
 * gateway deja pasar `ANY /chat/*` (exige este módulo) y nadie lo compra ni lo apaga. Diseño en backend/chat-service/IMPLEMENTATION.md.
 *
 * Antes estaba «en construcción» con precio 3,99 (semilla de precios). Como las demás migraciones de catálogo, no lee la semilla
 * (`seed/*.json`), que se edita a mano en otros frentes; `is_active` lo administra el negocio y no se toca. Idempotente.
 *
 * Orden de despliegue: plugin-catalog-service ANTES que el gateway con `/chat/*` (si no, la ruta responde 403 PLUGIN_NOT_ACTIVE).
 */
const CODE = 'comm.internal_chat';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE plugins SET is_core = 1, price_cents = 0, build_status = 'disponible', updated_at = :now WHERE code = :code",
      { replacements: { code: CODE, now: new Date() } },
    );
  },

  // Vuelve a ser un módulo aparte en construcción (lo que era). Las organizaciones no pierden nada guardado: el núcleo no tiene filas.
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE plugins SET is_core = 0, price_cents = 399, build_status = 'en_construccion', updated_at = :now WHERE code = :code",
      { replacements: { code: CODE, now: new Date() } },
    );
  },
};
