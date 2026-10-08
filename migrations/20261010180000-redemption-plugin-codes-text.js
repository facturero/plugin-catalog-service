/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   * Con el carrito, un canje de descuento puede cubrir varios módulos a la vez: `plugin_code` guarda los códigos separados
   * por coma y ya no cabe en 100 caracteres. Los canjes de un solo módulo quedan igual.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('discount_redemptions', 'plugin_code', {
      type: Sequelize.TEXT,
      allowNull: false,
      comment: 'Los módulos que la persona eligió activar con este canje, separados por coma.',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('discount_redemptions', 'plugin_code', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
  },
};
