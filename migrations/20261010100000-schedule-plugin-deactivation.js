/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   * Desactivar un módulo de pago es «suave»: no desaparece al instante, sino al terminar el periodo que la organización
   * ya tiene pago. `deactivate_at` guarda esa fecha mientras el módulo sigue activo y funcionando; un barrido periódico
   * lo apaga de verdad (status = 'disabled') cuando llega. Nulo = no hay desactivación programada.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organization_plugins', 'deactivate_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('organization_plugins', ['deactivate_at'], { name: 'idx_organization_plugins_deactivate_at' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('organization_plugins', 'idx_organization_plugins_deactivate_at');
    await queryInterface.removeColumn('organization_plugins', 'deactivate_at');
  },
};
