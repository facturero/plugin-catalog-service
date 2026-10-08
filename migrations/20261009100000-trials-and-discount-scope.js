/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   *  - organization_trials: la prueba gratis de cada organización (una sola fila por organización). Arranca con el primer
   *    ingreso de su administrador y dura TRIAL_MONTHS meses; es de la organización, no de cada módulo.
   *  - discounts.fixed_applies_to: en un descuento de monto fijo, si se resta POR MÓDULO ('plugin', lo normal: «$2 menos a cada
   *    módulo al mes») o UNA VEZ sobre el total ('total'). En porcentaje no cambia nada. Los ya creados quedan en 'plugin'.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organization_trials', {
      organization_id: { type: Sequelize.CHAR(36), primaryKey: true },
      started_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      started_by_user_id: { type: Sequelize.CHAR(36), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addColumn('discounts', 'fixed_applies_to', {
      type: Sequelize.ENUM('plugin', 'total'),
      allowNull: false,
      defaultValue: 'plugin',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('discounts', 'fixed_applies_to');
    await queryInterface.dropTable('organization_trials');
  },
};
