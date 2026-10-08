'use strict';

/**
 * `processed_events` es la tabla de idempotencia de quien CONSUME eventos (`InboxConsumer`). plugin-catalog-service no consume ninguno:
 * nada del código la lee ni la escribe, y quedó de la plantilla con la que nació el servicio. Mantenerla creaba una
 * tabla huérfana con una forma distinta a la de los servicios que sí la usan. Si algún día este servicio consume
 * eventos, la migración que lo introduzca debe crearla con la forma de `outbox-relay` (id, event_type, routing_key,
 * payload, status, last_error, processed_at).
 */
module.exports = {
  async up(queryInterface) {
    // dropTable de Sequelize es DROP TABLE IF EXISTS: no falla si la tabla ya no está.
    await queryInterface.dropTable('processed_events');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('processed_events', {
      event_id: { type: Sequelize.CHAR(36), primaryKey: true },
      event_type: { type: Sequelize.STRING(100), allowNull: true },
      routing_key: { type: Sequelize.STRING(200), allowNull: true },
      payload: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'processed' },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      processed_at: { type: Sequelize.DATE, allowNull: false },
    });
  },
};
