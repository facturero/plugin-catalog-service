/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. business_profiles
    await queryInterface.createTable('business_profiles', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      code: { type: Sequelize.STRING(100), allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      icon: { type: Sequelize.STRING(100), allowNull: false, defaultValue: 'mdi-storefront-outline' },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('business_profiles', ['code'], { unique: true });
    await queryInterface.addIndex('business_profiles', ['is_active']);

    // 2. business_profile_plugins
    await queryInterface.createTable('business_profile_plugins', {
      business_profile_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'business_profiles', key: 'id' },
        onDelete: 'CASCADE',
      },
      plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      recommendation: {
        type: Sequelize.ENUM('essential', 'suggested'),
        allowNull: false,
      },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    });

    // 3. business_profile_translations
    await queryInterface.createTable('business_profile_translations', {
      business_profile_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'business_profiles', key: 'id' },
        onDelete: 'CASCADE',
      },
      locale: { type: Sequelize.STRING(5), primaryKey: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
    });

    // 4. organization_business_profiles
    await queryInterface.createTable('organization_business_profiles', {
      organization_id: { type: Sequelize.CHAR(36), primaryKey: true },
      business_profile_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'business_profiles', key: 'id' },
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('selected', 'skipped'),
        allowNull: false,
        defaultValue: 'selected',
      },
      decided_by_user_id: { type: Sequelize.CHAR(36), allowNull: true },
      decided_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('organization_business_profiles', ['organization_id'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organization_business_profiles');
    await queryInterface.dropTable('business_profile_translations');
    await queryInterface.dropTable('business_profile_plugins');
    await queryInterface.dropTable('business_profiles');
  },
};
