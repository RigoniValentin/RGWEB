# ARCA — Facturación Electrónica: Checklist de Implementación

## A. Entorno de Testing (Homologación)

### 1. Generar certificado de testing

> **Nota:** Ejecutar todos los comandos desde la **raíz del proyecto** (donde está `appdata.ini`), no desde dentro de `certs/`.

- [ ] Generar clave privada:
  ```bash
  openssl genrsa -out certs/arca_testing.key 2048
  ```
- [ ] Generar CSR (Certificate Signing Request):
  ```bash
  # En Git Bash (Windows) agregar MSYS_NO_PATHCONV=1 para evitar conversión de paths
  MSYS_NO_PATHCONV=1 openssl req -new -key certs/arca_testing.key -subj "/C=AR/O=NombreEmpresa/CN=NombreEmpresa/serialNumber=CUIT XXXXXXXXXXX" -out certs/arca_testing.csr
  ```
- [ ] Ingresar al portal de **ARCA Testing** → https://wsaahomo.afip.gov.ar/wss/
  - Autenticarse con CUIT + clave fiscal
  - Ir a **Administración de certificados** → Crear nuevo certificado
  - Subir el `.csr` generado
  - Descargar el certificado `.crt` y guardarlo como `certs/arca_testing.crt`

### 2. Crear Punto de Venta en ARCA Testing

- [ ] Ingresar al portal testing → https://wswhomo.afip.gov.ar/wsfev1/
  - O usar el ABM de puntos de venta en la web de ARCA testing
- [ ] Crear un punto de venta de tipo **Web Services** (no fiscal)
- [ ] Tomar nota del número de punto de venta asignado (ej: `00001`)

### 3. Autorizar servicio WSFEv1 al certificado

- [ ] En el portal ARCA Testing (WSASS/Autogestión de accesos):
  - Ingresar a **Administración de relaciones** → **Agregar relación de servicio**
  - Habilitar el servicio `wsfe` (Facturación Electrónica v1)
  - Asociar el certificado de testing creado en el paso 1

### 4. Configurar `appdata.ini`

- [ ] Agregar o verificar las siguientes claves en la sección `[DatabaseSettings]`:
  ```ini
  UtilizaFE=SI
  ArcaCuit=XXXXXXXXXXX          # CUIT sin guiones (11 dígitos)
  ArcaCertPath=certs/arca_testing.crt
  ArcaKeyPath=certs/arca_testing.key
  ArcaEnvironment=testing
  ```
- [ ] Reiniciar el backend para que lea la nueva configuración

### 5. Verificar conectividad

- [ ] Abrir en el navegador o con curl (endpoint público, no requiere token):
  ```bash
  curl http://localhost:3001/api/sales/fe-health
  ```
  Debe responder: `{ "wsfe": "OK", "environment": "testing", ... }`

### 6. Probar emisión de factura

- [ ] Crear una venta desde el sistema con la opción "Emitir Factura Electrónica" activada
- [ ] Verificar que se obtiene un CAE válido y se muestra el número de comprobante
- [ ] Probar la descarga de PDF y la impresión de ticket 80mm desde el listado de ventas

### 7. Datos de testing útiles

| Concepto | Valor |
|---|---|
| WSAA Testing | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` |
| WSFEv1 Testing | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Portal Testing | `https://wsaahomo.afip.gov.ar/wss/` |
| CUIT testing genérico | Se usa el CUIT real del contribuyente |
| CAE de testing | Son válidos pero **no tienen valor fiscal** |

---

## B. Pase a Producción

### 1. Generar certificado de producción

> **Nota:** Ejecutar todos los comandos desde la **raíz del proyecto** (donde está `appdata.ini`), no desde dentro de `certs/`.

- [ ] Generar nueva clave privada para producción:
  ```bash
  openssl genrsa -out certs/arca_produccion.key 2048
  ```
- [ ] Generar CSR de producción:
  ```bash
  # En Git Bash (Windows) agregar MSYS_NO_PATHCONV=1 para evitar conversión de paths
  MSYS_NO_PATHCONV=1 openssl req -new -key certs/arca_produccion.key -subj "/C=AR/O=NombreEmpresa/CN=NombreEmpresa/serialNumber=CUIT XXXXXXXXXXX" -out certs/arca_produccion.csr
  ```
- [ ] Ingresar al portal de **ARCA Producción** → https://wsaa.afip.gov.ar/wss/
  - Autenticarse con CUIT + clave fiscal (nivel 3 o superior)
  - Ir a **Administración de certificados** → Crear nuevo certificado
  - Subir el `.csr` de producción
  - Descargar el `.crt` y guardarlo como `certs/arca_produccion.crt`

> **IMPORTANTE:** El certificado de producción es diferente al de testing. No reutilizar.

### 2. Crear Punto de Venta en ARCA Producción

- [ ] Ingresar a ARCA Producción con clave fiscal
- [ ] Ir a **ABM de puntos de venta** → Crear nuevo punto de venta
  - Tipo: **Web Services**
  - Nombre descriptivo (ej: "RIO GESTION WEB")
- [ ] Tomar nota del número asignado
- [ ] Verificar que el punto de venta esté creado en la tabla `PUNTO_VENTAS` de la base de datos

### 3. Autorizar servicio WSFEv1 en producción

- [ ] En ARCA Producción → **Administración de relaciones de clave fiscal**:
  - Servicio: `wsfe` — Facturación Electrónica
  - Asociar el certificado de producción al servicio

### 4. Actualizar `appdata.ini`

- [ ] Cambiar las claves ARCA:
  ```ini
  ArcaCertPath=certs/arca_produccion.crt
  ArcaKeyPath=certs/arca_produccion.key
  ArcaEnvironment=production
  ```
- [ ] Verificar que `ArcaCuit` sea el CUIT correcto del contribuyente

### 5. Reiniciar y verificar

- [ ] Reiniciar el backend
- [ ] Verificar el health check:
  ```bash
  curl http://localhost:3001/api/sales/fe-health
  ```
  Debe responder: `{  "AppServer": "OK","DbServer": "OK", "AuthServer": "OK" ... }`

### 6. Primera factura real

- [ ] Emitir una factura de prueba con un monto mínimo
- [ ] Verificar en el portal de ARCA (Mis Comprobantes) que el comprobante aparece correctamente
- [ ] Confirmar que la numeración del comprobante es la esperada (punto de venta + número correlativo)
- [ ] Verificar el PDF generado: datos fiscales, CAE, fecha de vencimiento
- [ ] Verificar el ticket 80mm: que se imprima correctamente con todos los datos fiscales

---

## C. Seguridad — Protección de Certificados

- [ ] **NUNCA** commitear certificados de producción al repositorio
- [ ] Agregar al `.gitignore`:
  ```
  certs/arca_produccion.*
  ```
- [ ] En el servidor de producción, los archivos `.key` y `.crt` deben tener permisos restringidos:
  ```bash
  chmod 600 certs/arca_produccion.key
  chmod 644 certs/arca_produccion.crt
  ```
- [ ] Respaldar los certificados de producción en un lugar seguro fuera del servidor

---

## D. Referencia Rápida — Archivos Clave

| Archivo | Descripción |
|---|---|
| `appdata.ini` | Configuración encriptada (CUIT, paths de certs, entorno) |
| `certs/arca_*.key` | Clave privada RSA 2048 bits |
| `certs/arca_*.csr` | Solicitud de certificado (se sube a ARCA) |
| `certs/arca_*.crt` | Certificado firmado por ARCA |
| `backend/src/config/appdata.ts` | Lectura y parseo del INI |
| `backend/src/config/index.ts` | Exporta `config.arca.*` |
| `backend/src/services/arca/wsaa.ts` | Autenticación WSAA (obtiene Token+Sign) |
| `backend/src/services/arca/wsfev1.ts` | Cliente SOAP WSFEv1 (emite comprobantes) |
| `backend/src/services/facturacion.service.ts` | Lógica de negocio de facturación |

---

## E. Troubleshooting

| Problema | Causa habitual | Solución |
|---|---|---|
| `ns1:coe.notAuthorized` | El certificado no tiene el servicio `wsfe` autorizado | Autorizar en ARCA → Administración de relaciones |
| `TA bloqueado 12h` | Se generó un TA con certificado incorrecto | Esperar que expire (12h) o generar nuevo certificado |
| `CondicionIVAReceptorId inválido` | Condición de IVA del cliente mal mapeada | Verificar mapeo en `facturacion.service.ts` |
| `Error OpenSSL / CMS` | OpenSSL no instalado o path incorrecto | Verificar `openssl version` en el servidor |
| `ECONNREFUSED` al endpoint ARCA | Sin acceso a internet o firewall bloqueando | Verificar conectividad a `wsaa.afip.gov.ar` y `servicios1.afip.gov.ar` |
| CAE con fecha vencida | El comprobante se emitió con fecha anterior | Los comprobantes deben emitirse con fecha del día |
| Numeración salteada | Se consultó `FECompUltimoAutorizado` y hubo emisiones paralelas | Usar un solo servidor emitiendo facturas por punto de venta |
