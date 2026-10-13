const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Da de alta en el catálogo los dos módulos del plugin de restaurantes.
 *
 * Por qué una migración y no solo la semilla: `20260830130000-seed-plugins.cjs`
 * ya está registrada en SequelizeMeta en las bases existentes, así que añadir
 * filas al JSON no llega a producción (ese seeder corre una sola vez). Esta es
 * la que sí se ejecuta. En una base nueva la semilla los inserta antes —lee el
 * JSON ya actualizado— y aquí se encuentran y no se tocan: es idempotente.
 *
 * `restaurant.floorplan` depende de `org.establishments`, que es del núcleo
 * (`included: true` → `is_core`), así que la arista NO se crea: el seeder omite
 * las dependencias hacia el núcleo (ya están activas para todos) y crear una
 * aquí haría que una base migrada y una recién sembrada no coincidieran.
 * `restaurant.reservations` (entregable 2, aún sin código) sí arrastra una arista
 * real hacia `restaurant.floorplan`.
 *
 * El precio es PROVISIONAL (599 y 699 centavos): el dueño aún no lo ha decidido.
 * Se aplica con el mismo criterio que 20261008120000-apply-plugin-prices.cjs: no
 * pisa un precio que ya se haya fijado a mano.
 */
const CODES = ['restaurant.floorplan', 'restaurant.reservations'];
const PROFILE_CODE = 'food.restaurant';
const LOCALES = ['en', 'fr'];

const statusToBuildStatus = {
  hecho: 'disponible',
  parcial: 'en_construccion',
  falta: 'en_construccion',
};

const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();

    const catalogo = seed('plugins-dependencias.json');
    const i18n = seed('plugins-i18n.json');
    const precios = seed('plugins-precios.json').precios_cents;
    const perfiles = seed('perfiles-negocio.json');

    const modulos = new Map(catalogo.modulos.map((m) => [m.id, m]));
    const coreIds = new Set([
      ...catalogo.infra_existente.map((i) => i.id),
      ...catalogo.modulos.filter((m) => m.included === true).map((m) => m.id),
    ]);

    for (const code of CODES) {
      if (!modulos.has(code)) throw new Error(`La semilla no define el módulo ${code}`);
    }

    // 1. Altas que falten. Si ya existe (base nueva), no se pisa su metadata:
    //    price_cents / is_active los administra el negocio, no la migración.
    const existing = await sequelize.query('SELECT code FROM plugins WHERE code IN (:codes)', {
      replacements: { codes: CODES },
      type: QueryTypes.SELECT,
    });
    const existingCodes = new Set(existing.map((r) => r.code));

    const inserts = CODES.filter((code) => !existingCodes.has(code)).map((code) => {
      const m = modulos.get(code);
      return {
        id: crypto.randomUUID(),
        code,
        name: m.name,
        category: m.category,
        description: m.description,
        image_url: null,
        build_status: statusToBuildStatus[m.status] || 'en_construccion',
        price_cents: precios[code] ?? 0,
        currency: 'USD',
        is_active: true,
        is_core: false,
        created_for_organization_id: null,
        based_on_plugin_id: null,
        created_at: now,
        updated_at: now,
      };
    });
    if (inserts.length > 0) await queryInterface.bulkInsert('plugins', inserts);

    // `restaurant.floorplan` ya está construido y verificado contra MySQL: debe poder activarse. El estado de construcción lo
    // decide el catálogo (no el negocio), así que se fija aunque la fila ya existiera (base sembrada antes de verificarlo).
    await sequelize.query("UPDATE plugins SET build_status = 'disponible', updated_at = :now WHERE code = 'restaurant.floorplan'", {
      replacements: { now },
    });

    // Precio provisional para los que sigan en 0 (no pisa un precio ya fijado a mano).
    for (const code of CODES) {
      const cents = precios[code] ?? 0;
      if (cents === 0) continue;
      await sequelize.query(
        'UPDATE plugins SET price_cents = :cents, updated_at = :now WHERE code = :code AND price_cents = 0 AND is_core = 0',
        { replacements: { cents, now, code } },
      );
    }

    const idByCode = new Map(
      (
        await sequelize.query('SELECT id, code FROM plugins WHERE code IN (:codes)', {
          replacements: { codes: CODES },
          type: QueryTypes.SELECT,
        })
      ).map((r) => [r.code, r.id]),
    );

    // 2. Dependencias entre módulos vendibles; las que apuntan al núcleo se saltan.
    for (const code of CODES) {
      for (const dep of modulos.get(code).depends_on ?? []) {
        if (!modulos.has(dep) || coreIds.has(dep)) continue;
        await sequelize.query(
          `INSERT IGNORE INTO plugin_dependencies (plugin_id, depends_on_plugin_id, auto_activate)
           VALUES (:pluginId, :depId, 1)`,
          { replacements: { pluginId: idByCode.get(code), depId: idByCode.get(dep) } },
        );
      }
    }

    // 3. Traducciones. La categoría se traduce por su texto en español (una sola
    //    etiqueta compartida), como en 20260830140010.
    for (const code of CODES) {
      const m = modulos.get(code);
      for (const locale of LOCALES) {
        const tr = i18n[code]?.[locale];
        const category = i18n._meta.categorias[m.category]?.[locale];
        if (!tr || !category) {
          throw new Error(`Falta la traducción ${locale} de ${code} o de su categoría "${m.category}"`);
        }
        await sequelize.query(
          `INSERT IGNORE INTO plugin_translations (plugin_id, locale, name, category, description, created_at, updated_at)
           VALUES (:pluginId, :locale, :name, :category, :description, :now, :now)`,
          { replacements: { pluginId: idByCode.get(code), locale, name: tr.name, category, description: tr.description, now } },
        );
      }
    }

    // 4. Vínculo con el perfil de negocio (sugerido para un restaurante).
    const profile = perfiles.profiles.find((p) => p.code === PROFILE_CODE);
    const [profileRow] = await sequelize.query('SELECT id FROM business_profiles WHERE code = :code', {
      replacements: { code: PROFILE_CODE },
      type: QueryTypes.SELECT,
    });
    const link = profile?.plugins.find((pl) => pl.code === 'restaurant.floorplan');
    if (profileRow && link && idByCode.has(link.code)) {
      await sequelize.query(
        `INSERT IGNORE INTO business_profile_plugins (business_profile_id, plugin_id, recommendation, sort_order)
         VALUES (:profileId, :pluginId, :recommendation, :sortOrder)`,
        {
          replacements: {
            profileId: profileRow.id,
            pluginId: idByCode.get(link.code),
            recommendation: link.recommendation,
            sortOrder: link.sort_order,
          },
        },
      );
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;

    const rows = await sequelize.query('SELECT id FROM plugins WHERE code IN (:codes)', {
      replacements: { codes: CODES },
      type: QueryTypes.SELECT,
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;

    const byIds = { replacements: { ids } };
    await sequelize.query('DELETE FROM business_profile_plugins WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM organization_cart_items WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM plugin_translations WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query(
      'DELETE FROM plugin_dependencies WHERE plugin_id IN (:ids) OR depends_on_plugin_id IN (:ids)',
      byIds,
    );
    await sequelize.query('UPDATE organization_plugins SET required_by_plugin_id = NULL WHERE required_by_plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM organization_plugins WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('UPDATE plugins SET based_on_plugin_id = NULL WHERE based_on_plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM plugins WHERE id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM discount_plugins WHERE plugin_code IN (:codes)', { replacements: { codes: CODES } });
  },
};
