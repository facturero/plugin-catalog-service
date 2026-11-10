/**
 * Proyectos y tareas sale a la venta (decisión del dueño, 2026-11-10): los cuatro módulos `projects.*` pasan de «en construcción» a
 * disponibles. projects-service está en producción con los 7 entregables y el dueño lo probó con datos reales.
 *
 * Precio: el tablero (`projects.tasks_kanban`) queda en 4,99 USD al mes por organización, fijado aquí porque es decisión explícita
 * del dueño (puede que la base lo tenga en otro valor si alguien lo tocó). Los complementos conservan el precio que ya tienen
 * (horas 3,99; carga de trabajo 5,99; facturar el proyecto 6,99, sembrados por `20261008120000-apply-plugin-prices.cjs`): esta
 * migración no los toca.
 *
 * Como la de `20261104110000-projects-plugins-asana.cjs`, no lee la semilla (`seed/*.json`), que se edita a mano en otros frentes.
 * `is_active` lo administra el negocio y no se toca. Idempotente.
 */
const CODES = ['projects.tasks_kanban', 'projects.time_tracking', 'projects.resource_allocation', 'projects.project_billing'];
const KANBAN_PRICE_CENTS = 499;

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.query(
      "UPDATE plugins SET build_status = 'disponible', updated_at = :now WHERE code IN (:codes) AND build_status <> 'disponible'",
      { replacements: { codes: CODES, now } },
    );
    await queryInterface.sequelize.query(
      'UPDATE plugins SET price_cents = :cents, updated_at = :now WHERE code = :code AND price_cents <> :cents',
      { replacements: { code: 'projects.tasks_kanban', cents: KANBAN_PRICE_CENTS, now } },
    );
  },

  // Volver a «en construcción» no apaga lo que las organizaciones ya activaron: solo deja de ofrecerse en el catálogo.
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE plugins SET build_status = 'en_construccion', updated_at = :now WHERE code IN (:codes)",
      { replacements: { codes: CODES, now: new Date() } },
    );
  },
};
