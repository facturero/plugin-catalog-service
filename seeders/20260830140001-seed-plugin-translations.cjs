const fs = require('fs');
const path = require('path');

const LOCALES = ['en', 'fr'];

/**
 * Siembra las traducciones del catalogo. El idioma base (es) vive en la propia
 * tabla `plugins` y actua de fallback, asi que aqui solo entran en/fr.
 *
 * Idempotente como el seeder de plugins: inserta lo que falta y actualiza lo que
 * cambio, sin tocar filas de otros locales que alguien haya cargado a mano.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '..', 'seed', 'plugins-i18n.json'),
      'utf8',
    );
    const data = JSON.parse(raw);
    const categories = data._meta.categorias;

    const plugins = await queryInterface.sequelize.query(
      'SELECT id, code, category FROM plugins',
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );

    const existing = new Map(
      (
        await queryInterface.sequelize.query(
          'SELECT plugin_id, locale, name, category, description FROM plugin_translations',
          { type: queryInterface.sequelize.QueryTypes.SELECT },
        )
      ).map((r) => [`${r.plugin_id}|${r.locale}`, r]),
    );

    const now = new Date();
    const inserts = [];

    for (const plugin of plugins) {
      const entry = data[plugin.code];
      if (!entry) continue; // plugin a medida de una organizacion: no se traduce

      for (const locale of LOCALES) {
        const translated = entry[locale];
        if (!translated) continue;

        // La categoria se traduce por su valor en español, no por plugin: son 13
        // etiquetas compartidas y mantenerlas por plugin invitaba a que se
        // desincronizaran entre si.
        const category = categories[plugin.category]?.[locale];
        if (!category) {
          throw new Error(
            `Falta la traduccion ${locale} de la categoria "${plugin.category}" (plugin ${plugin.code})`,
          );
        }

        const key = `${plugin.id}|${locale}`;
        const current = existing.get(key);
        const want = {
          name: translated.name,
          category,
          description: translated.description,
        };

        if (!current) {
          inserts.push({
            plugin_id: plugin.id,
            locale,
            ...want,
            created_at: now,
            updated_at: now,
          });
        } else if (
          current.name !== want.name ||
          current.category !== want.category ||
          current.description !== want.description
        ) {
          await queryInterface.bulkUpdate(
            'plugin_translations',
            { ...want, updated_at: now },
            { plugin_id: plugin.id, locale },
          );
        }
      }
    }

    if (inserts.length > 0) {
      await queryInterface.bulkInsert('plugin_translations', inserts);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('plugin_translations', { locale: LOCALES });
  },
};
