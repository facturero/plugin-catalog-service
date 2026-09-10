const fs = require('fs');
const path = require('path');

/**
 * Ex-seeder 20260909090002, promovido a migración (migraciones.md). Idempotente:
 * compara por `business_profile_id:locale`, no por fila. Antes leía
 * `SELECT business_profile_id` pero comparaba contra `r.locale` (undefined):
 * el set nunca coincidía → re-insertaba → colisión de PK en el deploy.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '..', 'seed', 'perfiles-negocio.json'),
      'utf8',
    );
    const data = JSON.parse(raw);

    const existing = await queryInterface.sequelize.query(
      `SELECT business_profile_id, locale FROM business_profile_translations`,
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    const existingSet = new Set(existing.map((r) => `${r.business_profile_id}:${r.locale}`));

    const profiles = await queryInterface.sequelize.query(
      `SELECT id, code FROM business_profiles`,
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    const profileIdByCode = new Map(profiles.map((r) => [r.code, r.id]));

    const entries = [];
    for (const p of data.profiles) {
      const pid = profileIdByCode.get(p.code);
      if (!pid) continue;
      for (const [locale, tr] of Object.entries(p.translations || {})) {
        if (existingSet.has(`${pid}:${locale}`)) continue;
        entries.push({
          business_profile_id: pid,
          locale,
          name: tr.name,
          description: tr.description,
        });
      }
    }

    if (entries.length > 0) {
      await queryInterface.bulkInsert('business_profile_translations', entries);
    }
  },

  async down() {},
};