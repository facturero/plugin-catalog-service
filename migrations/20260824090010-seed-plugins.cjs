const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_CATEGORY = 'Nucleo del sistema';

const statusToBuildStatus = {
  hecho: 'disponible',
  parcial: 'en_construccion',
  falta: 'en_construccion',
};

/**
 * Ex-seeder 20260824090001, promovido a migración (migraciones.md: las semillas
 * se ejecutan una vez, no en cada deploy). Idempotente: inserta lo que falta y
 * actualiza la metadata que cambió, sin pisar price_cents / is_active / image_url
 * (los administra el negocio, no el seed).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '..', 'seed', 'plugins-dependencias.json'),
      'utf8',
    );
    const data = JSON.parse(raw);

    // Items de infra_existente: no son vendibles, pero se siembran con is_core = true
    // para que el catalogo pueda mostrarlos como "incluido" y para que nadie los
    // publique como plugin por error. Cubiertos por auth-service / organization-service
    // / product-service / tax-service / api-gateway.
    const coreRows = (data.infra_existente || []).map((item) => ({
      code: item.id,
      name: item.name,
      category: CORE_CATEGORY,
      description: item.description,
      build_status: 'disponible',
      is_core: true,
    }));
    const coreIds = new Set(coreRows.map((r) => r.code));

    const moduleRows = data.modulos.map((m) => ({
      code: m.id,
      name: m.name,
      category: m.category,
      description: m.description,
      build_status: statusToBuildStatus[m.status] || 'en_construccion',
      is_core: false,
    }));

    const desired = [...coreRows, ...moduleRows];
    const desiredByCode = new Map(desired.map((r) => [r.code, r]));

    const now = new Date();
    const existing = new Map(
      (
        await queryInterface.sequelize.query(
          'SELECT id, code, name, category, description, build_status, is_core FROM plugins',
          { type: queryInterface.sequelize.QueryTypes.SELECT },
        )
      ).map((r) => [r.code, r]),
    );

    // 1. Altas.
    const inserts = desired
      .filter((r) => !existing.has(r.code))
      .map((r) => ({
        id: crypto.randomUUID(),
        code: r.code,
        name: r.name,
        category: r.category,
        description: r.description,
        image_url: null,
        build_status: r.build_status,
        price_cents: 0,
        currency: 'USD',
        is_active: true,
        is_core: r.is_core,
        created_for_organization_id: null,
        based_on_plugin_id: null,
        created_at: now,
        updated_at: now,
      }));
    if (inserts.length > 0) {
      await queryInterface.bulkInsert('plugins', inserts);
    }

    // 2. Actualizaciones de metadata. price_cents, is_active e image_url se dejan
    //    intactos a proposito: los administra el negocio, no el seed.
    for (const [code, row] of existing) {
      const want = desiredByCode.get(code);
      if (!want) continue;
      const changed =
        row.name !== want.name ||
        row.category !== want.category ||
        row.description !== want.description ||
        row.build_status !== want.build_status ||
        Boolean(row.is_core) !== want.is_core;
      if (!changed) continue;
      await queryInterface.bulkUpdate(
        'plugins',
        {
          name: want.name,
          category: want.category,
          description: want.description,
          build_status: want.build_status,
          is_core: want.is_core,
          updated_at: now,
        },
        { code },
      );
    }

    const codeToId = new Map(
      (
        await queryInterface.sequelize.query('SELECT id, code FROM plugins', {
          type: queryInterface.sequelize.QueryTypes.SELECT,
        })
      ).map((r) => [r.code, r.id]),
    );

    // 3. Aristas entre modulos vendibles. Las que apuntan a un plugin del nucleo se
    //    saltan: ese plugin ya esta activo para todos, y registrarlo como dependencia
    //    llenaria organization_plugins de filas que nadie puede desactivar.
    const depRows = [];
    const seenEdges = new Set();
    for (const m of data.modulos) {
      if (!Array.isArray(m.depends_on)) continue;
      for (const depCode of m.depends_on) {
        if (!desiredByCode.has(depCode) || coreIds.has(depCode)) continue;
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

  async down() {},
};