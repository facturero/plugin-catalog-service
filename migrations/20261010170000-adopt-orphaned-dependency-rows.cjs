/**
 * Cuando un módulo pasa a ir incluido en la plataforma, lo que se había activado «por dependencia» de él se queda huérfano:
 * su fila dice «requerido por X», pero X ya no se contrata ni existe como fila. Caso real: una organización activó
 * «sincronización offline» y eso trajo el POS como dependencia; al pasar la sincronización a incluida, el POS (que SÍ se
 * paga) quedaba como «Requerido por otro» sin que nadie lo necesitara y sin botón para desactivarlo.
 *
 * Esas filas pasan a ser contratación directa (la organización tiene y paga ese módulo): ya no dependen de nadie y se pueden
 * desactivar como cualquier otro. Es idempotente.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE organization_plugins
          SET activation_source = 'direct', required_by_plugin_id = NULL
        WHERE activation_source = 'dependency'
          AND required_by_plugin_id IN (SELECT id FROM plugins WHERE is_core = 1)`,
    );
  },

  // No se distingue qué filas eran por dependencia antes: la contratación directa es lo que hay que conservar.
  async down() {},
};
