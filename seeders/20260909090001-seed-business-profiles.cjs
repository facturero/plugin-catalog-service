const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '..', 'seed', 'perfiles-negocio.json'),
      'utf8',
    );
    const data = JSON.parse(raw);

    const existing = await queryInterface.sequelize.query(
      `SELECT id FROM business_profiles`,
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    const existingIds = new Set(existing.map((r) => r.id));

    const now = new Date();

    for (const p of data.profiles) {
      if (existingIds.has(p.code)) continue;

      const profileId = crypto.randomUUID();
      await queryInterface.bulkInsert('business_profiles', [
        {
          id: profileId,
          code: p.code,
          name: p.name,
          description: p.description,
          icon: p.icon,
          sort_order: p.sort_order,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ]);

      // Resolver IDs de plugins por código
      const pluginRows = await queryInterface.sequelize.query(
        `SELECT id, code FROM plugins WHERE code IN (:codes)`,
        {
          replacements: { codes: p.plugins.map((pl) => pl.code) },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        },
      );
      const pluginIdByCode = new Map(pluginRows.map((r) => [r.code, r.id]));

      const pluginEntries = p.plugins
        .filter((pl) => pluginIdByCode.has(pl.code))
        .map((pl) => ({
          business_profile_id: profileId,
          plugin_id: pluginIdByCode.get(pl.code),
          recommendation: pl.recommendation,
          sort_order: pl.sort_order,
        }));

      if (pluginEntries.length > 0) {
        await queryInterface.bulkInsert('business_profile_plugins', pluginEntries);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('business_profile_plugins');
    await queryInterface.bulkDelete('business_profiles');
  },
};
