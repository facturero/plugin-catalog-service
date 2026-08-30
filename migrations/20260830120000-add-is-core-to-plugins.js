/**
 * Plugins del nucleo: piezas que toda organizacion tiene siempre activas
 * (multi-tenencia, RBAC, catalogo de productos, gateway, catalogo fiscal).
 * No se venden ni se pueden desactivar, pero necesitan existir como filas
 * para que el catalogo pueda mostrarlas como "incluido" y para que nadie
 * las publique como vendibles por error.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('plugins', 'is_core', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex('plugins', ['is_core']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('plugins', ['is_core']);
    await queryInterface.removeColumn('plugins', 'is_core');
  },
};
