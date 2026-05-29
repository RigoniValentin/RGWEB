# Contrato Estándar — Pedidos de Tienda Online → RG WEB

> Este documento define el **estándar único** que cualquier tienda online (Tricarios y
> futuros clientes) debe cumplir para enviar pedidos al sistema de gestión RG WEB.
> La idea es que cada tienda sea **carrocería** sobre el mismo motor de pedidos.

## Resumen del flujo

```
Tienda Online (front)                RG WEB Backend                       Operador (panel)
─────────────────────                ──────────────                       ────────────────
1. Checkout finaliza
   POST /api/external/                ──► Valida payload (Zod)
       tienda-orders                      Persiste en TIENDA_ORDERS
       x-api-key                          estado=pendiente
                                        ◄── 201 { tiendaOrderId, estado }
                                                                          2. Ve "Pedidos Tienda"
                                                                             Click "Procesar"
                                            POST /tienda-orders/:id/procesar
                                            ► salesService.create()
                                            estado=procesado, VENTA_ID asignado
                                                                          3. (opcional) "Facturar"
                                            POST /tienda-orders/:id/facturar
                                            ► facturacionService.emitirFactura()
                                            ► sendComprobanteEmail(stub)
                                            estado=facturado, CAE asignado
```

## Endpoint público

```
POST  {RGWEB_BASE_URL}/api/external/tienda-orders
Headers:
  Content-Type: application/json
  x-api-key:    <api_key_generada_en_panel>
```

Idempotente por `(tiendaOrigen, externalOrderId)`. Reintentar es seguro.

### Body (JSON)

| Campo                 | Tipo       | Requerido | Notas                                                  |
| --------------------- | ---------- | --------- | ------------------------------------------------------ |
| `externalOrderId`     | string     | sí        | ID único del pedido en la tienda (máx. 120 chars).     |
| `tiendaOrigen`        | string     | sí        | Slug de la tienda (`tricarios`, `cliente-x`, etc.).    |
| `fechaPedido`         | ISO date   | no        | Default: `now` del backend.                            |
| `cliente`             | objeto     | no        | Snapshot del comprador. Ver tabla abajo.               |
| `items`               | array(1+)  | sí        | Líneas de productos. Ver tabla abajo.                  |
| `pago`                | objeto     | no        | Método/estado/referencia del pago.                     |
| `envio`               | objeto     | no        | `metodo: retiro|envio`, `direccion`, `costo`.          |
| `totales`             | objeto     | no        | `subtotal`, `descuentos`, `envio`, `total`.            |
| `observaciones`       | string     | no        | Hasta 1000 chars.                                      |

**`cliente`** — todos opcionales:
`nombre`, `documento`, `tipoDocumento` (DNI|CUIT|CF), `email`, `telefono`,
`direccion`, `localidad`, `provincia`, `cp`.

**`items[]`**:

| Campo            | Tipo    | Requerido | Notas                                                                 |
| ---------------- | ------- | --------- | --------------------------------------------------------------------- |
| `productoId`     | int     | preferido | ID en `PRODUCTOS` de RG WEB. Si la tienda lo conoce, mandalo siempre. |
| `sku`            | string  | fallback  | Si no hay `productoId`, el operador podrá vincularlo desde la UI.     |
| `nombre`         | string  | no        | Snapshot descriptivo (lo que vio el cliente).                         |
| `cantidad`       | number  | sí        | Positivo (admite decimales).                                          |
| `precioUnitario` | number  | sí        | El que cobró la tienda (autoritativo).                                |
| `descuento`      | number  | no        | Porcentaje 0–100.                                                     |
| `subtotal`       | number  | no        | Informativo; el cálculo real se hace al crear la venta.               |

### Respuestas

```jsonc
// 201 — primera vez
{ "status": "received", "tiendaOrderId": 17, "estado": "pendiente" }

// 200 — duplicado (mismo externalOrderId + tiendaOrigen)
{ "status": "duplicate", "tiendaOrderId": 17, "estado": "pendiente" }

// 400 — datos inválidos (Zod)
{ "error": "Datos inválidos", "detalles": [{ "path": ["items", 0, "cantidad"], "message": "..." }] }

// 401 — api-key inválida
{ "error": "API key inválida" }

// 500 — error interno; el evento queda en INTEGRACIONES_SYNC_LOGS para auditoría
```

## Endpoints administrativos (panel RG WEB)

Prefijo: `/api/tienda-orders` — Auth: JWT del panel + permisos `tienda_orders.*`.

| Método | Path                              | Permiso                  | Descripción                             |
| ------ | --------------------------------- | ------------------------ | --------------------------------------- |
| GET    | `/`                               | `tienda_orders.ver`      | Lista con filtros + paginación.         |
| GET    | `/counts`                         | `tienda_orders.ver`      | Conteo por estado (badges del menú).    |
| GET    | `/:id`                            | `tienda_orders.ver`      | Cabecera + items del pedido.            |
| POST   | `/:id/procesar`                   | `tienda_orders.procesar` | Convierte en VENTA usando `salesService`. |
| POST   | `/:id/facturar`                   | `tienda_orders.facturar` | Emite FE + dispara mail de comprobante. |
| POST   | `/:id/cancelar`                   | `tienda_orders.cancelar` | Cancela con motivo.                     |
| POST   | `/:id/reenviar-mail`              | `tienda_orders.facturar` | Reintenta envío de comprobante.         |

### Estados (`TIENDA_ORDERS.ESTADO`)

| Estado       | Significado                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| `pendiente`  | Recién recibido. Visible en la bandeja. Único estado que admite "Procesar".    |
| `procesado`  | Convertido en `VENTAS` (`VENTA_ID` asignado). Listo para facturar.             |
| `facturado`  | Tiene CAE/comprobante. El email queda registrado en `EMAIL_ENVIADO_AT`.        |
| `cancelado`  | Descartado por el operador. No se puede facturar después; emitir NC si aplica. |

## Tablas DB

Migración: [`database/migrate-tienda-orders.sql`](../database/migrate-tienda-orders.sql).

- `TIENDA_ORDERS` — cabecera (UNIQUE `(TIENDA_ORIGEN, EXTERNAL_ORDER_ID)`).
- `TIENDA_ORDERS_ITEMS` — detalle de productos (FK con `ON DELETE CASCADE`).
- Filas nuevas en `INTEGRACIONES_CONFIG`:
  - `tienda_orders_auto_facturar` (`0`/`1`) — reservado para v2.
  - `tienda_orders_email_remitente` — reservado para integración SMTP.
- Permisos agregados en `PERMISOS_WEB`: `tienda_orders.{ver,procesar,facturar,cancelar}`.

## Cómo replicar en otro cliente

Para integrar una nueva tienda online:

1. En el panel RG WEB → **Integraciones** → **API Keys** → generar una key con
   scope `orders` para el nuevo cliente (y guardarla, se muestra una sola vez).
2. En el front de la tienda, configurar variables de entorno (o el equivalente):
   ```
   VITE_RGWEB_BASE_URL=https://<tunnel-cloudflare-cliente>
   VITE_RGWEB_API_KEY=<api_key_generada>
   VITE_TIENDA_ORIGEN=<slug-cliente>
   ```
3. En el checkout llamar:
   ```ts
   import { storeOrdersService } from "@/services/storeOrdersService";

   const payload = storeOrdersService.buildPayloadFromCart({
     orderId: order.id,
     cart: cart.items,
     customer: { nombre, email, documento, ... },
     payment: { metodo: "MERCADOPAGO", estado: "aprobado", referencia: mpPaymentId },
     shipping: { metodo: "envio", direccion, costo },
     notes,
   });
   await storeOrdersService.sendOrder(payload);
   ```
4. En **Integraciones** del panel: setear `orders_default_cliente_id` y
   `orders_default_punto_venta_id` (defaults para el procesamiento batch).
5. Asignar permisos `tienda_orders.*` al rol del operador que gestionará pedidos.

## Pendientes (roadmap)

- **Email real**: actualmente `sendComprobanteEmail()` es un stub que sólo
  registra el intento en `INTEGRACIONES_SYNC_LOGS`. Falta integración SMTP
  (nodemailer) + plantilla HTML + PDF del comprobante.
- **Auto-facturado**: ya hay flag `tienda_orders_auto_facturar` reservado, no
  cableado todavía.
- **Webhook out**: notificar a la tienda los cambios de estado del pedido
  (procesado/facturado/cancelado) usando el `webhook.dispatcher` existente.
- **Vinculación SKU**: UI para resolver items que llegaron sólo con `sku` y
  no con `productoId`.
