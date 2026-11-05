const crypto = require('crypto');

/**
 * Proyectos y tareas «al estilo Asana» (`projects-service`, ficha `servicios/projects-service.md` de la bóveda).
 *
 * Los cuatro módulos `projects.*` ya existen como filas desde `20260830130000-seed-plugins.cjs` (en construcción, con nombres
 * genéricos). Esta migración los prepara para venderse SIN publicarlos todavía:
 *
 *   1. Nombre comercial y descripción nuevos (es/en/fr). Se vende como Asana: el nombre tiene que decir lo mismo que Asana dice.
 *   2. `projects.resource_allocation` deja de depender de `hr.employees`: ese módulo no existe, y la carga de trabajo se calcula
 *      con los usuarios de auth-service. Con la arista, nadie podría activarlo nunca.
 *   3. Dos perfiles de negocio nuevos que lo recomiendan: agencia y constructora. `services.professional` ya lo recomendaba.
 *
 * El estado de construcción NO se toca: siguen `en_construccion` hasta que el dueño pruebe el entregable 1 con datos reales.
 * Para publicar el tablero:
 *     UPDATE plugins SET build_status = 'disponible' WHERE code = 'projects.tasks_kanban';
 * El precio y `is_active` los administra el negocio y tampoco se tocan.
 *
 * Por qué no lee la semilla (`seed/*.json`): es un archivo compartido que se edita a mano en otros frentes; como la de los anexos
 * del SRI, esta migración lleva sus datos dentro. Idempotente: se puede correr dos veces.
 */
const PLUGINS = {
  'projects.tasks_kanban': {
    es: {
      name: 'Proyectos y tareas',
      description:
        'Organiza el trabajo de tu equipo como en Asana: proyectos con vista de lista y tablero, tareas y subtareas con responsable ' +
        'y fecha, «Mis tareas» de cada persona y proyectos privados. Precio por empresa, no por usuario.',
    },
    en: {
      name: 'Projects and tasks',
      description:
        'Organize your team\'s work the way you do in Asana: projects with list and board views, tasks and subtasks with an ' +
        'assignee and due date, everyone\'s "My tasks" and private projects. Priced per company, not per user.',
    },
    fr: {
      name: 'Projets et tâches',
      description:
        'Organisez le travail de votre équipe comme dans Asana : projets en vue liste et tableau, tâches et sous-tâches avec ' +
        'responsable et échéance, « Mes tâches » de chacun et projets privés. Prix par entreprise, pas par utilisateur.',
    },
  },
  'projects.time_tracking': {
    es: { name: 'Registro de horas', description: 'Cronómetro y registro manual de horas por tarea, facturables o no, con reporte por persona y proyecto.' },
    en: { name: 'Time tracking', description: 'Timer and manual time entries per task, billable or not, with reports by person and project.' },
    fr: { name: 'Suivi du temps', description: 'Chronomètre et saisie manuelle des heures par tâche, facturables ou non, avec rapport par personne et par projet.' },
  },
  'projects.resource_allocation': {
    es: { name: 'Carga de trabajo', description: 'Ve cuánto trabajo tiene asignado cada persona por semana y reparte tareas antes de que alguien se sature.' },
    en: { name: 'Workload', description: 'See how much work each person has per week and rebalance tasks before anyone is overloaded.' },
    fr: { name: 'Charge de travail', description: 'Voyez la charge de chaque personne par semaine et répartissez les tâches avant que quelqu\'un soit débordé.' },
  },
  'projects.project_billing': {
    es: { name: 'Facturación de proyectos', description: 'Factura al cliente las horas o los hitos de un proyecto con factura electrónica del SRI, sin volver a digitar nada.' },
    en: { name: 'Project billing', description: 'Invoice a project\'s hours or milestones to the customer as an SRI electronic invoice, without retyping anything.' },
    fr: { name: 'Facturation de projets', description: 'Facturez au client les heures ou les jalons d\'un projet par facture électronique du SRI, sans rien ressaisir.' },
  },
};

const REMOVED_DEPENDENCY = { plugin: 'projects.resource_allocation', dependsOn: 'hr.employees' };

const PROFILES = [
  {
    code: 'services.agency',
    icon: 'mdi-bullhorn-outline',
    es: { name: 'Agencia (marketing, diseño, desarrollo)', description: 'Proyectos para clientes, entregas con fecha y horas que se facturan.' },
    en: { name: 'Agency (marketing, design, development)', description: 'Client projects, dated deliverables and billable hours.' },
    fr: { name: 'Agence (marketing, design, développement)', description: 'Projets clients, livrables datés et heures facturables.' },
    plugins: [
      ['crm.contacts', 'essential'],
      ['finance.electronic_invoicing', 'essential'],
      ['projects.tasks_kanban', 'essential'],
      ['projects.time_tracking', 'suggested'],
      ['projects.project_billing', 'suggested'],
      ['crm.quotes', 'suggested'],
    ],
  },
  {
    code: 'construction.contractor',
    icon: 'mdi-hard-hat',
    es: { name: 'Constructora / contratista', description: 'Obras por etapas, compras de material y avance por hitos.' },
    en: { name: 'Construction / contractor', description: 'Staged jobs, material purchasing and milestone-based progress.' },
    fr: { name: 'Construction / entrepreneur', description: 'Chantiers par étapes, achats de matériaux et avancement par jalons.' },
    plugins: [
      ['crm.contacts', 'essential'],
      ['finance.electronic_invoicing', 'essential'],
      ['projects.tasks_kanban', 'essential'],
      ['purchasing.purchase_orders', 'suggested'],
      ['inventory.kardex', 'suggested'],
      ['projects.project_billing', 'suggested'],
    ],
  },
];

const LOCALES = ['en', 'fr'];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const now = new Date();
    const idOf = async (code) =>
      (await sequelize.query('SELECT id FROM plugins WHERE code = :code', { replacements: { code }, type: QueryTypes.SELECT }))[0]?.id;

    // 1. Nombres y descripciones.
    for (const [code, tr] of Object.entries(PLUGINS)) {
      const pluginId = await idOf(code);
      if (!pluginId) continue;
      await sequelize.query('UPDATE plugins SET name = :name, description = :description, updated_at = :now WHERE id = :pluginId', {
        replacements: { name: tr.es.name, description: tr.es.description, now, pluginId },
      });
      for (const locale of LOCALES) {
        await sequelize.query(
          'UPDATE plugin_translations SET name = :name, description = :description, updated_at = :now WHERE plugin_id = :pluginId AND locale = :locale',
          { replacements: { name: tr[locale].name, description: tr[locale].description, now, pluginId, locale } },
        );
      }
    }

    // 2. Carga de trabajo sin `hr.employees`.
    const pluginId = await idOf(REMOVED_DEPENDENCY.plugin);
    const depId = await idOf(REMOVED_DEPENDENCY.dependsOn);
    if (pluginId && depId) {
      await sequelize.query('DELETE FROM plugin_dependencies WHERE plugin_id = :pluginId AND depends_on_plugin_id = :depId', {
        replacements: { pluginId, depId },
      });
    }

    // 3. Perfiles de negocio.
    const [{ maxOrder }] = await sequelize.query('SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM business_profiles', { type: QueryTypes.SELECT });
    let order = Number(maxOrder);
    for (const profile of PROFILES) {
      const [existing] = await sequelize.query('SELECT id FROM business_profiles WHERE code = :code', {
        replacements: { code: profile.code },
        type: QueryTypes.SELECT,
      });
      const profileId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        order += 1;
        await queryInterface.bulkInsert('business_profiles', [
          {
            id: profileId,
            code: profile.code,
            name: profile.es.name,
            description: profile.es.description,
            icon: profile.icon,
            sort_order: order,
            is_active: true,
            created_at: now,
            updated_at: now,
          },
        ]);
      }
      for (const locale of LOCALES) {
        await sequelize.query(
          `INSERT IGNORE INTO business_profile_translations (business_profile_id, locale, name, description)
           VALUES (:profileId, :locale, :name, :description)`,
          { replacements: { profileId, locale, name: profile[locale].name, description: profile[locale].description } },
        );
      }
      for (const [index, [code, recommendation]] of profile.plugins.entries()) {
        const recommendedId = await idOf(code);
        if (!recommendedId) continue;
        await sequelize.query(
          `INSERT IGNORE INTO business_profile_plugins (business_profile_id, plugin_id, recommendation, sort_order)
           VALUES (:profileId, :recommendedId, :recommendation, :sortOrder)`,
          { replacements: { profileId, recommendedId, recommendation, sortOrder: index + 1 } },
        );
      }
    }
  },

  async down(queryInterface) {
    // Solo se deshacen los perfiles nuevos: los nombres y la arista anterior no se restauran (la arista apuntaba a un módulo que no existe).
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize;
    const rows = await sequelize.query('SELECT id FROM business_profiles WHERE code IN (:codes)', {
      replacements: { codes: PROFILES.map((p) => p.code) },
      type: QueryTypes.SELECT,
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    const byIds = { replacements: { ids } };
    await sequelize.query('DELETE FROM organization_business_profiles WHERE business_profile_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM business_profile_plugins WHERE business_profile_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM business_profile_translations WHERE business_profile_id IN (:ids)', byIds);
    await sequelize.query('DELETE FROM business_profiles WHERE id IN (:ids)', byIds);
  },
};
