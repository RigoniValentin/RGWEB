# GUIA DE TESTEO EN DESARROLLO: INTEGRACION RG WEB <-> TRICARIOS

Este documento define el workflow simplificado para probar la integracion entre RG WEB y Tricarios usando **un solo tunel Cloudflare**.

La decision de arquitectura es:

1. **RG WEB es el componente on-premise**: vive en la maquina/red del cliente y necesita Cloudflare Tunnel para ser accesible desde afuera.
2. **Tricarios es cloud-native**: en produccion tiene una URL publica real; en desarrollo corre localmente en la misma maquina del desarrollador.
3. **En desarrollo no se levanta tunel para TricariosBack**: RG WEB puede llamar directamente a `http://localhost:3015` porque ambos procesos corren en la misma maquina.

## 1. Mapa De Conectividad

### Desarrollo Local

```text
TricariosFront (localhost/Vite)
        |
        | POST pedidos / pull catalogo
        v
Cloudflare Tunnel publico -> RG WEB localhost:3001

RG WEB localhost:3001
        |
        | POST webhook stock/precio
        v
TricariosBack localhost:3015
        |
        | Socket.IO localhost
        v
TricariosFront sin recargar pagina
```

### Produccion

```text
TricariosFront publico
        |
        | POST pedidos / pull catalogo
        v
Cloudflare Tunnel estable -> RG WEB on-premise:3001

RG WEB on-premise:3001
        |
        | POST webhook stock/precio
        v
https://api.tricarios.com/api/v1/external/rg/webhook/stock
        |
        | Socket.IO publico
        v
TricariosFront publico sin recargar pagina
```

> Regla operativa: **el unico tunel Cloudflare es el de RG WEB**. El webhook configurado en RG WEB apunta a TricariosBack: en dev a `localhost:3015`, en prod a la URL publica real de TricariosBack.

---

## 2. Preparacion Del Entorno Local

Antes de empezar, levantar SQL Server, MongoDB y las dependencias habituales.

### Paso A: Levantar RG WEB Backend

En una terminal:

```bash
cd "RG WEB/backend"
npm run dev
```

Validar que RG WEB este escuchando en el puerto `3001`.

### Paso B: Levantar El Unico Tunel Cloudflare

En otra terminal:

```bash
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3001
```

Cloudflare va a generar una URL temporal similar a:

```text
https://algunas-palabras-random.trycloudflare.com
```

En esta guia la llamaremos:

```text
RG_WEB_PUBLIC_URL=https://algunas-palabras-random.trycloudflare.com
```

Esta URL se usa para que TricariosFront y TricariosBack puedan pegarle a RG WEB desde afuera del proceso local.

### Paso C: Configurar TricariosFront Para Enviar Pedidos A RG WEB

En `TricariosFront/.env.local`:

```env
VITE_RGWEB_BASE_URL=<RG_WEB_PUBLIC_URL>
VITE_RGWEB_API_KEY=<TU_API_KEY_DE_INTEGRACION>
VITE_TIENDA_ORIGEN=tricarios
```

Luego reiniciar Vite para que tome las variables:

```bash
cd "TricariosFront"
npm run dev
```

### Paso D: Levantar TricariosBack Local

En otra terminal:

```bash
cd "TricariosBack"
npm run dev
```

Por defecto TricariosBack escucha en:

```text
http://localhost:3015
```

Variables recomendadas para el entorno local de TricariosBack:

```env
RG_INTEGRATION_ENABLED=true
RG_API_BASE_URL=<RG_WEB_PUBLIC_URL>
RG_API_KEY=<TU_API_KEY_DE_INTEGRACION>
RG_WEBHOOK_SECRET=<SECRET_COMPARTIDO_CON_RG_WEB>
RG_DEFAULT_CATEGORY_ID=<ID_CATEGORIA_MONGO_PARA_PRODUCTOS_NUEVOS>
```

### Paso E: Configurar El Webhook En RG WEB

En RG WEB ir a **Integraciones Externas -> Webhook**.

Para **desarrollo local**, completar:

| Campo | Valor |
|---|---|
| URL del Webhook | `http://localhost:3015/api/v1/external/rg/webhook/stock` |
| Secret (HMAC SHA-256) | El mismo valor que `RG_WEBHOOK_SECRET` en TricariosBack |
| Webhook habilitado | Activado |
| Reintentos maximos | `3` recomendado |
| Cliente por defecto (ID) | ID del cliente generico/Consumidor Final para pedidos web |
| Punto de venta por defecto (ID) | ID del punto de venta usado para procesar/facturar pedidos web |

Para **produccion**, la URL del Webhook cambia a la URL publica real de TricariosBack:

```text
https://api.tricarios.com/api/v1/external/rg/webhook/stock
```

Despues de guardar, presionar **Probar conexion**. RG WEB enviara un `POST` al webhook configurado. En desarrollo ese POST sale de RG WEB `localhost:3001` y entra directo a TricariosBack `localhost:3015`, sin Cloudflare de por medio.

---

## 3. Contrato Del Webhook RG WEB -> TricariosBack

### Endpoint Receptor

TricariosBack debe exponer:

```http
POST /api/v1/external/rg/webhook/stock
```

El endpoint debe:

1. Capturar el body JSON crudo (`rawBody`).
2. Validar `X-RG-Signature` con HMAC-SHA256 usando `RG_WEBHOOK_SECRET`.
3. Aceptar `stock.updated`, `stock.full_sync` y `webhook.test`.
4. Actualizar productos por `Product.managementId === PRODUCTO_ID`.
5. Emitir por Socket.IO el cambio aplicado para que TricariosFront actualice sin recargar.
6. Responder `2xx` cuando el evento fue procesado o ignorado de forma controlada.

### Firma HMAC

RG WEB firma el body exacto enviado:

```text
X-RG-Signature: hex(hmac_sha256(RG_WEBHOOK_SECRET, rawBody))
```

La validacion debe hacerse contra el `rawBody`, no contra `JSON.stringify(req.body)`. Tambien debe usarse comparacion en tiempo constante (`crypto.timingSafeEqual`).

### Payload De Cambio Puntual

Cuando cambia precio o stock en RG WEB, el dispatcher agrupa cambios durante unos segundos y envia:

```json
{
  "event": "stock.updated",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "data": {
    "items": [
      {
        "PRODUCTO_ID": 123,
        "CODIGO": "ABC-001",
        "NOMBRE": "Producto ejemplo",
        "PRECIO": 15000,
        "STOCK": 8,
        "ACTIVO": true,
        "CODIGO_BARRAS": "7790000000000"
      }
    ]
  }
}
```

### Payload De Sincronizacion Completa

Cuando se presiona **Sincronizar catalogo completo** en RG WEB:

```json
{
  "event": "stock.full_sync",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "data": {
    "items": [
      {
        "PRODUCTO_ID": 123,
        "CODIGO": "ABC-001",
        "NOMBRE": "Producto ejemplo",
        "PRECIO": 15000,
        "STOCK": 8,
        "ACTIVO": true,
        "CODIGO_BARRAS": "7790000000000"
      }
    ]
  }
}
```

### Mapeo Esperado En Tricarios

| RG WEB | TricariosBack |
|---|---|
| `PRODUCTO_ID` | `Product.managementId` |
| `PRECIO` | `Product.price` |
| `STOCK` | `Product.stockCount` |
| `ACTIVO && STOCK > 0` | `Product.inStock` |
| `NOMBRE` | `Product.name` si se decide pisar el nombre desde RG WEB |
| `CODIGO` / `CODIGO_BARRAS` | Referencia externa opcional/log |

El vinculo canonico es `managementId`. Un producto sin `managementId` no puede actualizarse automaticamente desde RG WEB.

---

## 4. Socket.IO En Desarrollo Local

TricariosBack ya corre Socket.IO sobre el mismo servidor HTTP que Express. En desarrollo, TricariosFront debe conectarse al backend local:

```text
Socket.IO URL: http://localhost:3015
```

El flujo recomendado es:

1. RG WEB envia `POST http://localhost:3015/api/v1/external/rg/webhook/stock`.
2. TricariosBack valida HMAC y actualiza MongoDB.
3. TricariosBack emite un evento Socket.IO global o a una sala de catalogo.
4. TricariosFront escucha el evento y actualiza su estado/cache por `managementId`.
5. La card, el detalle y el carrito recalculan precio/stock sin `F5`.

Evento sugerido desde TricariosBack:

```ts
io.emit("products:stock-price-updated", {
  source: "rg-web",
  items: [
    {
      managementId: 123,
      price: 15000,
      stockCount: 8,
      inStock: true,
    },
  ],
});
```

Comportamiento esperado en TricariosFront:

1. Conectarse a `http://localhost:3015` en desarrollo.
2. Registrar un unico listener para `products:stock-price-updated`.
3. Limpiar el listener al desmontar el componente/hook para evitar duplicados.
4. Actualizar productos comparando `product.managementId` con `item.managementId`.
5. Si un producto esta en carrito, recalcular subtotal/total o mostrar aviso de precio actualizado.
6. Si `stockCount <= 0` o `inStock === false`, bloquear nuevas compras de ese item.

Nota: en produccion el frontend debe conectarse al dominio publico de TricariosBack, no al tunel de RG WEB.

---

## 5. Casos De Prueba: Pedidos Tricarios -> RG WEB

### Test 1: Envio Exitoso De Pedido

* **Accion:** Simular una compra desde TricariosFront.
* **Verificacion tecnica:**
  - En DevTools buscar `POST <RG_WEB_PUBLIC_URL>/api/external/tienda-orders`.
  - Debe responder `201 Created`.
  - El body debe incluir `{ "status": "RECEIVED" }`.
* **Verificacion en RG WEB:**
  - El pedido debe existir en `TIENDA_ORDERS`.
  - Los items deben existir en `TIENDA_ORDERS_ITEMS`.
  - En el panel **Pedidos Tienda** debe aparecer como `PENDIENTE`.

### Test 2: Idempotencia De Pedidos

* **Accion:** Reenviar el mismo `externalOrderId` y `tiendaOrigen`.
* **Verificacion:**
  - RG WEB debe responder `200 OK` con `{ "status": "DUPLICATE" }`.
  - No debe crear registros duplicados.
  - El intento debe quedar registrado en logs de integracion.

### Test 3: Gestion En Panel RG WEB

* **Accion:** Entrar a **Movimientos -> Pedidos Tienda**.
* **Verificacion:**
  - La pestana `PENDIENTE` debe incluir el pedido.
  - El drawer debe mostrar cliente, pago, envio, items, totales, costo de envio e IVA.
  - Las acciones `Procesar`, `Facturar` y `Cancelar` deben mover el pedido al estado correcto.

---

## 6. Casos De Prueba: Stock/Precio RG WEB -> Tricarios En Tiempo Real

### Test 4: Probar Conexion Del Webhook Local

* **Precondicion:** RG WEB y TricariosBack corren en la misma maquina.
* **Configuracion en RG WEB:**
  ```text
  URL del Webhook = http://localhost:3015/api/v1/external/rg/webhook/stock
  ```
* **Accion:** Presionar **Probar conexion** en RG WEB.
* **Verificacion en RG WEB:**
  - Debe mostrar exito.
  - En logs debe aparecer `webhook.test`, `OUTBOUND`, `SUCCESS`.
* **Verificacion en TricariosBack:**
  - Debe recibir el POST local.
  - Debe validar `X-RG-Signature`.
  - Si ignora `webhook.test`, debe responder `200` controlado.

### Test 5: Cambio Puntual De Precio

* **Precondicion:** Producto con `VENTA_WEB = 1` en RG WEB y `Product.managementId = PRODUCTO_ID` en MongoDB.
* **Accion:** Cambiar el precio en RG WEB y guardar.
* **Verificacion en RG WEB:**
  - Debe enviar `stock.updated` al webhook local.
  - Logs debe mostrar `OUTBOUND / stock.updated / SUCCESS`.
* **Verificacion en TricariosBack:**
  - Debe actualizar `Product.price`.
  - Debe emitir `products:stock-price-updated`.
* **Verificacion en TricariosFront:**
  - Con la pagina abierta antes del cambio, el precio debe cambiar sin recargar.
  - El carrito debe recalcular o advertir cambio de precio.

### Test 6: Cambio Puntual De Stock

* **Accion:** Cambiar stock en RG WEB.
* **Verificacion:**
  - El payload debe traer `STOCK` actualizado.
  - TricariosBack debe actualizar `stockCount` e `inStock`.
  - TricariosFront debe reflejar disponibilidad sin recargar.
  - Si `STOCK = 0` o `ACTIVO = false`, el item debe quedar no disponible para compra.

### Test 7: Sincronizacion Completa

* **Accion:** Presionar **Sincronizar catalogo completo** en RG WEB.
* **Verificacion:**
  - RG WEB debe enviar `stock.full_sync` con productos `VENTA_WEB = 1`.
  - TricariosBack debe aplicar updates por `managementId`.
  - Si `RG_DEFAULT_CATEGORY_ID` esta configurado, puede crear productos nuevos.
  - Si no hay categoria por defecto, los productos inexistentes deben quedar como `skipped`, no como error fatal.

### Test 8: Firma Invalida

* **Accion:** Enviar un POST manual a `http://localhost:3015/api/v1/external/rg/webhook/stock` con `X-RG-Signature` incorrecta.
* **Verificacion:**
  - TricariosBack debe responder `401`.
  - No debe modificar productos.
  - Debe registrar el rechazo para diagnostico.

### Test 9: Multiples Cambios Rapidos

* **Accion:** Cambiar precio y stock varias veces seguidas en RG WEB.
* **Verificacion:**
  - RG WEB puede agrupar cambios en un unico `stock.updated`.
  - TricariosBack debe aplicar el ultimo snapshot recibido.
  - TricariosFront no debe duplicar listeners ni eventos visuales.
  - La UI debe terminar mostrando el valor final de RG WEB.

---

## 7. Checklist Operativo

### Desarrollo

* Levantar RG WEB en `localhost:3001`.
* Levantar **un solo** Cloudflare Tunnel hacia `localhost:3001`.
* Configurar `VITE_RGWEB_BASE_URL=<RG_WEB_PUBLIC_URL>` en TricariosFront.
* Levantar TricariosBack en `localhost:3015`.
* Configurar en RG WEB el webhook local: `http://localhost:3015/api/v1/external/rg/webhook/stock`.
* TricariosFront se conecta por API/Socket.IO a `http://localhost:3015`.

### Produccion

* RG WEB mantiene su Cloudflare Tunnel estable hacia el puerto `3001`.
* TricariosBack usa dominio publico real, por ejemplo `https://api.tricarios.com`.
* En RG WEB, el webhook apunta a `https://api.tricarios.com/api/v1/external/rg/webhook/stock`.
* TricariosFront usa el dominio publico de TricariosBack para API y Socket.IO.

---

## 8. Notas Importantes

* **No usar dos tuneles en desarrollo:** el segundo tunel para TricariosBack no es necesario si RG WEB y TricariosBack corren en la misma maquina.
* **`localhost` en el Webhook de RG WEB es valido solo en desarrollo local:** significa "la misma maquina donde corre RG WEB".
* **Si RG WEB corre en otra PC, VM, Docker o WSL aislado:** `localhost:3015` ya no apunta a TricariosBack del host; en ese caso usar la IP LAN del host o ajustar networking.
* **El frontend no recibe webhooks HTTP:** TricariosFront recibe cambios en vivo por Socket.IO desde TricariosBack.
* **Solo productos vinculados se actualizan:** el vinculo depende de `Product.managementId` contra `PRODUCTO_ID` de RG WEB.
* **La URL del tunel expira en quick tunnel:** cada reinicio de `cloudflared` puede cambiar `RG_WEB_PUBLIC_URL`; actualizar `.env.local` y variables de TricariosBack si corresponde.
* **Logs en ambos lados:** RG WEB registra salientes en `INTEGRACIONES_SYNC_LOGS`; TricariosBack debe registrar entrantes para diagnostico.
* **Estados de pedidos:** se mantienen en `UPPERCASE` (`PENDIENTE`, `PROCESADO`, `FACTURADO`, `CANCELADO`).
