/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. plugins
    await queryInterface.createTable('plugins', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      code: { type: Sequelize.STRING(100), allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      image_url: { type: Sequelize.STRING(500), allowNull: true },
      build_status: {
        type: Sequelize.ENUM('disponible', 'en_construccion', 'descontinuado'),
        allowNull: false,
        defaultValue: 'disponible',
      },
      price_cents: { type: Sequelize.BIGINT, allowNull: false },
      currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'USD' },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_for_organization_id: { type: Sequelize.CHAR(36), allowNull: true },
      based_on_plugin_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('plugins', ['code'], { unique: true });
    await queryInterface.addIndex('plugins', ['created_for_organization_id']);

    // 2. plugin_dependencies
    await queryInterface.createTable('plugin_dependencies', {
      plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      depends_on_plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      auto_activate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    });
    await queryInterface.addConstraint('plugin_dependencies', {
      type: 'check',
      fields: ['plugin_id', 'depends_on_plugin_id'],
      where: Sequelize.literal('plugin_id <> depends_on_plugin_id'),
      name: 'chk_no_self_dependency',
    });

    // 3. organization_plugins
    await queryInterface.createTable('organization_plugins', {
      organization_id: { type: Sequelize.CHAR(36), primaryKey: true },
      plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      activation_source: {
        type: Sequelize.ENUM('direct', 'dependency'),
        allowNull: false,
      },
      required_by_plugin_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('active', 'disabled'),
        allowNull: false,
        defaultValue: 'active',
      },
      activated_at: { type: Sequelize.DATE, allowNull: false },
      deactivated_at: { type: Sequelize.DATE, allowNull: true },
    });

    // 4. plugin_custom_requests
    await queryInterface.createTable('plugin_custom_requests', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      based_on_plugin_ids: { type: Sequelize.JSON, allowNull: false },
      status: {
        type: Sequelize.ENUM('requested', 'quoted', 'created', 'rejected'),
        allowNull: false,
        defaultValue: 'requested',
      },
      resulting_plugin_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'SET NULL',
      },
      quoted_price_cents: { type: Sequelize.BIGINT, allowNull: true },
      rejection_reason: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('plugin_custom_requests', ['organization_id']);

    // 5. outbox_messages
    await queryInterface.createTable('outbox_messages', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      aggregate_type: { type: Sequelize.STRING(50), allowNull: false },
      aggregate_id: { type: Sequelize.CHAR(36), allowNull: false },
      type: { type: Sequelize.STRING(100), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      processed_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('outbox_messages', ['processed_at']);

    // 6. processed_events
    await queryInterface.createTable('processed_events', {
      event_id: { type: Sequelize.CHAR(36), primaryKey: true },
      processed_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('processed_events');
    await queryInterface.dropTable('outbox_messages');
    await queryInterface.dropTable('plugin_custom_requests');
    await queryInterface.dropTable('organization_plugins');
    await queryInterface.dropTable('plugin_dependencies');
    await queryInterface.dropTable('plugins');
  },
};
