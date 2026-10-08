/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   * Descuentos sobre el precio de los módulos, canjeables con un código.
   *  - discounts: la definición (tipo, valor, vigencia, topes, alcance).
   *  - discount_plugins: a qué módulos aplica (sin filas = a todos). Por código de módulo, que es estable entre bases.
   *  - discount_redemptions: cada canje, con el precio de lista, lo descontado y lo que quedó, para que el cobro futuro
   *    use lo que se prometió y no lo que valga el módulo ese día.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('discounts', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      code: { type: Sequelize.STRING(40), allowNull: false },
      name: { type: Sequelize.STRING(150), allowNull: false },
      kind: { type: Sequelize.ENUM('percent', 'fixed'), allowNull: false },
      value: { type: Sequelize.INTEGER, allowNull: false, comment: 'percent: puntos básicos (1500 = 15 %). fixed: centavos.' },
      valid_from: { type: Sequelize.DATE, allowNull: true },
      valid_until: { type: Sequelize.DATE, allowNull: true },
      max_redemptions: { type: Sequelize.INTEGER, allowNull: true },
      redemption_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      per_organization_limit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      organization_id: { type: Sequelize.CHAR(36), allowNull: true },
      duration_months: { type: Sequelize.INTEGER, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by_user_id: { type: Sequelize.CHAR(36), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('discounts', ['code'], { unique: true, name: 'discounts_code_unique' });
    await queryInterface.addIndex('discounts', ['organization_id']);

    await queryInterface.createTable('discount_plugins', {
      discount_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'discounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      plugin_code: { type: Sequelize.STRING(100), primaryKey: true },
    });

    await queryInterface.createTable('discount_redemptions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      discount_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'discounts', key: 'id' },
        onDelete: 'RESTRICT',
      },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      plugin_code: { type: Sequelize.STRING(100), allowNull: false, comment: 'El módulo que la persona eligió activar.' },
      redeemed_by_user_id: { type: Sequelize.CHAR(36), allowNull: true },
      list_cents: { type: Sequelize.BIGINT, allowNull: false },
      discount_cents: { type: Sequelize.BIGINT, allowNull: false },
      final_cents: { type: Sequelize.BIGINT, allowNull: false },
      redeemed_at: { type: Sequelize.DATE, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('discount_redemptions', ['discount_id', 'organization_id']);
    await queryInterface.addIndex('discount_redemptions', ['organization_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('discount_redemptions');
    await queryInterface.dropTable('discount_plugins');
    await queryInterface.dropTable('discounts');
  },
};
