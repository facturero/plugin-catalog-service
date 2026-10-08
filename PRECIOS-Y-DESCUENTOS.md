# Precios y descuentos de los módulos

## Precios

- **Dónde están:** `seed/plugins-precios.json` (USD **al mes**, en centavos, **sin IVA**, **por organización y por módulo**, no por usuario).
  Incluye en `meta.referencias` contra qué se comparó (Contífico/Siigo, Zoho, Odoo, Loyverse, Alegra) y la fecha de revisión.
- **Cómo se aplican:** la migración `20261008120000-apply-plugin-prices.cjs` pone el precio SOLO a los módulos que siguen en `0`.
  Si alguien fijó uno a mano en la base, no se pisa. Los módulos del núcleo (`is_core`) no se venden y no tienen precio.
- **Para cambiar un precio después:** actualizarlo directo en la base (`UPDATE plugins SET price_cents = … WHERE code = …`) y
  reflejarlo en el JSON. La prueba `pricing.test.ts` obliga a que todo módulo tenga precio y vigila los paquetes típicos
  (por ejemplo, facturar = 9,99 USD; contabilidad completa desde cero = 42,96 USD, por debajo de los 55 USD de Contífico).
- **Los módulos base valen 0** (catálogo de productos, establecimientos, contactos, certificado): todos los necesitan para
  trabajar y, si costaran, inflarían la cotización de lo que de verdad se vende (la cotización suma las dependencias).
- Los módulos que aún no están construidos llevan precio objetivo, pero no se pueden comprar mientras estén «en construcción».

## Descuentos

Un descuento se canjea con un **código** y rebaja el precio mensual de lo que se activa en ese momento (el módulo y las
dependencias que todavía no estaban activas; lo ya activo no cuesta nada y no se descuenta).

| Qué | Cómo |
|---|---|
| Tipo | `percent` (15 = 15 %, hasta dos decimales) o `amountCents` (500 = 5,00 USD; nunca baja de cero) |
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
