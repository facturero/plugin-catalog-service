const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Da de alta el módulo «Anexos del SRI» (`compliance.sri_annexes`): ATS, formulario 103 y formulario 104 generados desde los comprobantes
 * del ERP (Fase 6.1 del plan). Lo sirve `reporting-service`.
 *
 * Por qué NO lee la semilla (`seed/*.json`) como las demás altas: el módulo es nuevo y la semilla es un archivo compartido que se
 * edita a mano en otros frentes; esta migración lleva sus datos dentro para no depender de ella ni pisarla. En una base nueva la
 * semilla no lo trae, así que esta migración es la única fuente.
 *
 * Nace en `en_construccion` a propósito: el catálogo decide el estado de construcción y un módulo así no debe poder activarse hasta que
 * el dueño lo pruebe con datos reales. Para publicarlo:
 *     UPDATE plugins SET build_status = 'disponible' WHERE code = 'compliance.sri_annexes';
 *
 * El precio (19,00 USD) es PROVISIONAL: lo decide el dueño. No se pisa uno ya fijado a mano.
 * Depende de la contabilidad general (los anexos se concilian con el libro mayor). Idempotente: se puede correr dos veces.
 */
const CODE = 'compliance.sri_annexes';
const CATEGORY = 'Facturacion y Finanzas';
const DEPENDS_ON = ['finance.general_ledger'];
const PRICE_CENTS = 1900;
const LOCALES = ['en', 'fr'];

const NAME = 'Anexos del SRI (ATS, formularios 103 y 104)';
const DESCRIPTION =
  'Prepara el ATS y los formularios 103 y 104 del SRI a partir de tus facturas, compras y retenciones, y los concilia con el libro mayor. ' +
  'Cada generación queda guardada como una versión, con los datos que faltan o están mal señalados antes de declarar.';
const TRANSLATIONS = {
  en: {
    name: 'SRI annexes (ATS, forms 103 and 104)',
    description:
      'Prepares the ATS and forms 103 and 104 for the SRI from your invoices, purchases and withholdings, and reconciles them with the general ledger. ' +
      'Every run is saved as a version, with missing or wrong data flagged before you file.',
  },
  fr: {
    name: 'Annexes du SRI (ATS, formulaires 103 et 104)',
    description:
      'Prépare l\'ATS et les formulaires 103 et 104 du SRI à partir de vos factures, achats et retenues, et les rapproche du grand livre. ' +
      'Chaque génération est conservée comme une version, avec les données manquantes ou erronées signalées avant de déclarer.',
  },
};

const seed = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'seed', name), 'utf8'));

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();

    const [existing] = await sequelize.query('SELECT id FROM plugins WHERE code = :code', { replacements: { code: CODE }, type: QueryTypes.SELECT });
    let pluginId = existing?.id;
    if (!pluginId) {
      pluginId = crypto.randomUUID();
      await queryInterface.bulkInsert('plugins', [
        {
          id: pluginId,
          code: CODE,
          name: NAME,
          category: CATEGORY,
          description: DESCRIPTION,
          image_url: null,
          build_status: 'en_construccion',
          price_cents: PRICE_CENTS,
          currency: 'USD',
          is_active: true,
          is_core: false,
          created_for_organization_id: null,
          based_on_plugin_id: null,
          created_at: now,
          updated_at: now,
        },
      ]);
    }

    // Los módulos incluidos (is_core) no son aristas: se dan con la cuenta, no se activan.
    for (const dependency of DEPENDS_ON) {
      const [dep] = await sequelize.query('SELECT id, is_core FROM plugins WHERE code = :dependency', { replacements: { dependency }, type: QueryTypes.SELECT });
      if (!dep || dep.is_core) continue;
      await sequelize.query(
        'INSERT IGNORE INTO plugin_dependencies (plugin_id, depends_on_plugin_id, auto_activate) VALUES (:pluginId, :depId, 1)',
        { replacements: { pluginId, depId: dep.id } },
      );
    }

    // La categoría se traduce por su texto en español, igual que en el resto del catálogo. Si la semilla no la trae, se usa el texto original.
    const categories = seed('plugins-i18n.json')._meta?.categorias?.[CATEGORY] ?? {};
    for (const locale of LOCALES) {
      const tr = TRANSLATIONS[locale];
      await sequelize.query(
        `INSERT IGNORE INTO plugin_translations (plugin_id, locale, name, category, description, created_at, updated_at)
         VALUES (:pluginId, :locale, :name, :category, :description, :now, :now)`,
        { replacements: { pluginId, locale, name: tr.name, category: categories[locale] ?? CATEGORY, description: tr.description, now } },
      );
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;

    const rows = await sequelize.query('SELECT id FROM plugins WHERE code = :code', { replacements: { code: CODE }, type: QueryTypes.SELECT });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;

    const byIds = { replacements: { ids } };
    await sequelize.query('DELETE FROM business_profile_plugins WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM organization_cart_items WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM plugin_translations WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM plugin_dependencies WHERE plugin_id IN (:ids) OR depends_on_plugin_id IN (:ids)', byIds);
    await sequelize.query('UPDATE organization_plugins SET required_by_plugin_id = NULL WHERE required_by_plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM organization_plugins WHERE plugin_id IN (:ids)', byIds);
    await sequelize.query('UPDATE plugins SET based_on_plugin_id = NULL WHERE based_on_plugin_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM plugins WHERE id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM discount_plugins WHERE plugin_code = :code', { replacements: { code: CODE } });
  },
};
