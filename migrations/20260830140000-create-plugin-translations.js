/**
 * Traducciones del catálogo.
 *
 * El nombre, la categoría y la descripción de un plugin son texto de negocio que
 * vive en la base, no en el frontend: el front no puede traducir lo que no conoce.
 * Se guardan por (plugin_id, locale) y la fila de `plugins` sigue siendo el
 * idioma base (es), que actúa de fallback cuando falta una traducción.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('plugin_translations', {
      plugin_id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        references: { model: 'plugins', key: 'id' },
        onDelete: 'CASCADE',
      },
      // BCP-47 corto ('es', 'en', 'fr'). 5 caracteres deja espacio a 'pt-BR'.
      locale: { type: Sequelize.STRING(5), primaryKey: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('plugin_translations', ['locale']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('plugin_translations');
  },
};
