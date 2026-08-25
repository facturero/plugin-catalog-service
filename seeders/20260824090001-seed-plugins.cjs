const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '..', 'seed', 'plugins-dependencias.json'),
      'utf8',
    );
    const data = JSON.parse(raw);

    // Items de infra_existente NO son plugins vendibles: ya están cubiertos por
    // auth-service / organization-service / product-service / tax-service.
    const infraIds = new Set();
    for (const item of data.infra_existente || []) {
      if (typeof item === 'string') infraIds.add(item);
      else if (item && item.id) infraIds.add(item.id);
    }

    const moduleIds = new Set(data.modulos.map((m) => m.id));
    const statusToBuildStatus = {
      hecho: 'disponible',
      parcial: 'en_construccion',
      falta: 'en_construccion',
    };

    const now = new Date();
    const existing = new Set(
      (await queryInterface.sequelize.query('SELECT code FROM plugins', { type: queryInterface.sequelize.QueryTypes.SELECT })).map((r) => r.code),
    );

    const pluginRows = data.modulos
      .filter((m) => !existing.has(m.id))
      .map((m) => ({
        id: crypto.randomUUID(),
        code: m.id,
        name: m.name,
        category: m.category,
        description: m.description,
        image_url: null,
        build_status: statusToBuildStatus[m.status] || 'en_construccion',
        price_cents: 0,
        currency: 'USD',
        is_active: true,
        created_for_organization_id: null,
        based_on_plugin_id: null,
        created_at: now,
        updated_at: now,
      }));
    if (pluginRows.length > 0) {
      await queryInterface.bulkInsert('plugins', pluginRows);
    }

    const codeToId = new Map(
      (await queryInterface.sequelize.query('SELECT id, code FROM plugins', { type: queryInterface.sequelize.QueryTypes.SELECT })).map((r) => [r.code, r.id]),
    );

    // Solo aristas entre módulos del catálogo: las que apuntan a
    // infra_existente se saltan (esa infra ya existe en el ecosistema).
    const depRows = [];
    const seenEdges = new Set();
    for (const m of data.modulos) {
      if (!Array.isArray(m.depends_on)) continue;
      for (const depCode of m.depends_on) {
        if (!moduleIds.has(depCode) || infraIds.has(depCode)) continue;
        if (depCode === m.id) continue;
        const edgeKey = `${m.id}->${depCode}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        depRows.push({
          plugin_id: codeToId.get(m.id),
          depends_on_plugin_id: codeToId.get(depCode),
          auto_activate: true,
        });
      }
    }
    if (depRows.length > 0) {
      await queryInterface.bulkInsert('plugin_dependencies', depRows, { ignoreDuplicates: true });
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('plugin_dependencies', {});
    await queryInterface.bulkDelete('organization_plugins', {});
    await queryInterface.sequelize.query('UPDATE plugin_custom_requests SET resulting_plugin_id = NULL');
    await queryInterface.sequelize.query('UPDATE plugins SET based_on_plugin_id = NULL');
    await queryInterface.bulkDelete('plugins', {
      created_for_organization_id: null,
    });
  },
};
