/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   * El carrito de módulos de cada organización. Vive en el servidor y no en el navegador: quien lo arma puede recargar,
   * cambiar de equipo o dejarlo para después y lo encuentra igual (y lo ve cualquier administrador de la organización).
   * Una fila por módulo en el carrito; al activarlo se borra.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organization_cart_items', {
      organization_id: { type: Sequelize.CHAR(36), primaryKey: true },
      plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      added_by_user_id: { type: Sequelize.CHAR(36), allowNull: true },
      added_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organization_cart_items');
  },
};
