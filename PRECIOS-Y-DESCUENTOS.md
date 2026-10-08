# Precios y descuentos de los módulos

## Precios

- **Dónde están:** `seed/plugins-precios.json` (USD **al mes**, en centavos, **sin IVA**, **por organización y por módulo**, no por usuario).
  Incluye en `meta.referencias` contra qué se comparó (Contífico/Siigo, Zoho, Odoo, Loyverse, Alegra) y la fecha de revisión.
- **Cómo se aplican:** la migración `20261008120000-apply-plugin-prices.cjs` pone el precio SOLO a los módulos que siguen en `0`.
  Si alguien fijó uno a mano en la base, no se pisa. Los módulos del núcleo (`is_core`) no se venden y no tienen precio.
- **Para cambiar un precio después:** actualizarlo directo en la base (`UPDATE plugins SET price_cents = … WHERE code = …`) y
  reflejarlo en el JSON. La prueba `pricing.test.ts` obliga a que todo módulo tenga precio y vigila los paquetes típicos
  (por ejemplo, facturar = 9,99 USD; contabilidad completa desde cero = 42,96 USD, por debajo de los 55 USD de Contífico).
- **Los módulos base van INCLUIDOS, no se venden** (catálogo de productos, establecimientos, contactos, certificado .p12,
  ajustes de la organización y notificaciones): todos los necesitan para trabajar. Se marcan `"included": true` en
  `seed/plugins-dependencias.json` y quedan como `is_core` en la base (migración `20261010120000`). Regla: **lo que no se cobra
  no se puede apagar.** Son núcleo: siempre activos para toda organización, sin fila en `organization_plugins` (el listado
  `GET /organizations/me/plugins` los informa como `activationSource: "included"` para que el gateway deje pasar sus rutas),
  no se activan ni se desactivan, no son dependencias de nadie y «Mis módulos» no los lista; el Catálogo los muestra «Incluido».
- Los módulos que aún no están construidos llevan precio objetivo, pero no se pueden comprar mientras estén «en construcción».

## Prueba gratis (3 meses, de toda la organización)

- **Es de la organización, no de cada módulo.** Arranca una sola vez, con el **primer ingreso del administrador** (quien tiene el
  permiso `plugins:manage`), y dura `TRIAL_MONTHS` meses (3 por defecto). Mientras dura, todos los módulos disponibles se
  activan sin pagar. Activar un módulo nuevo en el mes 2 **no** da otros 3 meses, y volver a ingresar no reinicia nada.
- **Cómo arranca:** el frontend consulta `GET /organizations/me/subscription` al cargar. Si quien consulta puede gestionar
  módulos y no había prueba, la crea (idempotente: dos ingresos a la vez crean una sola, y se publica `pricing.trial.started`).
  Si lo consulta alguien sin ese permiso, solo lee: no arranca la prueba de la organización.
- **Organizaciones que ya existían** cuando se lanzó esto: su prueba arranca la primera vez que su administrador ingrese
  DESPUÉS del lanzamiento, no desde que se crearon.
- **Un descuento no se gasta durante la prueba:** su duración (`durationMonths`) cuenta desde que termina la prueba.
- La cotización informa `trial` y `due_today` (0 mientras dure la prueba) además del total que se pagará después.

## Desactivar un módulo (baja «suave»)

Lo ya pagado se respeta: pedir la baja de un módulo de pago **no lo apaga en el acto**. Queda activo y funcionando hasta que
termina el periodo mensual que la organización ya tiene pago, y recién entonces desaparece de «Mis módulos».

- **Periodo:** se cuenta desde que el módulo empieza a cobrarse (su activación o, si la prueba gratis termina después, el fin de
  la prueba) y se repite cada mes desde esa misma fecha (31 de enero → 28 de febrero → 31 de marzo). Durante la prueba, el
  periodo vigente es la propia prueba. Está en `src/domain/billing-period.ts`.
- **Fecha:** se guarda en `organization_plugins.deactivate_at` (el estado sigue `active`). `GET /organizations/me/plugins`
  devuelve `deactivateAt` (la baja programada) y `periodEndsAt` (dónde terminaría el periodo ahora, para avisarlo antes de pedirla;
  `null` si el módulo es gratis).
- **Cumplirla:** un barrido (`ApplyDueDeactivationsUseCase`, cada `DEACTIVATION_SWEEP_SECONDS`, 300 por defecto, y al arrancar)
  apaga los módulos cuya fecha llegó, con su cascada, y publica `plugin.deactivated` (es el que escuchan inventario y el gateway).
  Si desde que se programó la organización activó algo que lo necesita, la baja se cancela sola (`plugin.deactivation_cancelled`,
  `reason: dependents`) en vez de romperle nada.
- **Arrepentirse:** `POST /organizations/me/plugins/:code/cancel-deactivation` borra la fecha; no se cobra nada nuevo.
- **Repetir** la petición no mueve la fecha. Un módulo **gratis** (precio 0) no tiene nada pago que esperar y se apaga en el acto.
- **Eventos:** `plugin.deactivation_scheduled` y `plugin.deactivation_cancelled` (auditoría y refresco de pantalla; no apagan nada).

## IVA

Los precios del JSON son **sin IVA**. El servicio suma `VAT_BPS` (1500 = 15 %, Ecuador) y lo informa en la cotización:
`vat_percent`, `vat_cents` (calculado sobre el total YA descontado, redondeado al centavo) y `total_with_vat`. El catálogo
muestra «+ IVA». Hoy es una sola tasa para todas las organizaciones, tomada del entorno y no de `tax-service`.

## Descuentos

Un descuento se canjea con un **código** y rebaja el precio mensual de lo que se activa en ese momento (el módulo y las
dependencias que todavía no estaban activas; lo ya activo no cuesta nada y no se descuenta).

| Qué | Cómo |
|---|---|
| Tipo | `percent` (15 = 15 %, hasta dos decimales) o `amountCents` (500 = 5,00 USD; nunca baja de cero) |
| Monto fijo: a qué se resta | `fixedAppliesTo`: `plugin` (por defecto) resta ese monto **a cada módulo** al mes (sin pasar de su precio); `total` lo resta **una sola vez** al total. En porcentaje es lo mismo. |
| Alcance | todos los módulos, o una lista de códigos de módulo (`pluginCodes`) |
| Vigencia | `validFrom` / `validUntil` (ISO 8601 con zona horaria) |
| Topes | `maxRedemptions` (global) y `perOrganizationLimit` (1 por defecto) |
| Privado | `organizationId`: solo esa organización lo puede usar |
| Duración | `durationMonths`: cuánto dura el descuento desde que se canjea; sin valor = mientras el módulo siga activo |
| Acumulación | no se acumulan: una activación admite un solo código |

Se **cotiza** sin gastar el código y se **canjea** solo al activar, dentro de la misma transacción (con la fila bloqueada para
que dos canjes a la vez no pasen el tope). Cada canje guarda el precio de lista, lo descontado y lo que quedó: el cobro
futuro debe usar eso y no el precio que tenga el módulo ese día. Hoy el sistema **no cobra** módulos; los descuentos quedan
registrados y listos para cuando haya facturación de suscripciones.

### Endpoints (organización)

```
GET  /organizations/me/plugins/:code/quote?discountCode=VEINTE
     → la cotización de siempre + { discount, total_after_discount }  ó  { discount_error: { code, message } }
POST /organizations/me/plugins/:code/activate        cuerpo opcional: { "discountCode": "VEINTE" }
GET  /organizations/me/discount-redemptions          los descuentos que ya canjeó esta organización
GET  /organizations/me/subscription                  prueba gratis e IVA (el administrador la arranca la primera vez)
```

Un código malo no tumba la cotización (200 con `discount_error`), pero sí impide activar (404 si no existe o es de otra
organización, 422 si está vencido, agotado, ya usado, desactivado o no aplica) y **no activa nada**.

### Endpoints (administración, permiso `plugins:admin`)

```
GET   /admin/discounts
POST  /admin/discounts            { "code": "LANZAMIENTO", "name": "Lanzamiento", "percent": 20,
                                    "pluginCodes": ["pos.core"], "validUntil": "2026-12-31T23:59:59-05:00",
                                    "maxRedemptions": 100, "durationMonths": 6 }
PATCH /admin/discounts/:id        { "name", "validFrom", "validUntil", "maxRedemptions", "perOrganizationLimit" }
POST  /admin/discounts/:id/deactivate
POST  /admin/discounts/:id/reactivate
```

El código, el tipo y el valor **no se cambian** una vez creados (ya hay quien los vio): se crea otro y se desactiva el viejo.

### Auditoría

`pricing.discount.created | updated | deactivated | reactivated` (administración, sin organización) y
`pricing.discount.redeemed` (con la organización). Llevan prefijo `pricing.` y no `plugin.` a propósito: el gateway recarga
los módulos de la organización con cada `plugin.*`.
