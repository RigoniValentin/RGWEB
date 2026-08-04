# Guía de actualización a v2 (cajas persistentes)

## TL;DR

Después de la migración a cajas persistentes, hay **3 correcciones** que deben aplicarse a cualquier base de datos para que el desglose por método de pago coincida exactamente con el balance:

1. `MOVIMIENTOS_CAJA.CAJA_ID` debe apuntar al consolidado (no a cajas viejas borradas).
2. `CAJA_ITEMS.SESION_ID` debe corresponder a la sesión correcta por fecha del item.
3. El código backend debe excluir `TRANSFERENCIA_FC` del cálculo del balance (ya está aplicado en `cajaCentral.service.ts`).

**Las correcciones 1 y 2 ya están integradas al script de migración principal** (`migrar-cajas-persistentes-completo.sql` → FASES 2.7 y 2.8). Solo se necesita correr el script completo una vez.

---

## Pasos para actualizar una base de datos existente (ej. SesamoDB)

### Pre-requisitos

- Backup completo de la DB (por las dudas)
- Acceso con usuario que pueda `ALTER` tablas y crear constraints
- El script `database/Updates/migrar-cajas-persistentes-completo.sql` debe estar actualizado (con las FASES 2.7 y 2.8 ya integradas)

### Paso 1: Detener el backend

```bash
# Si está corriendo con npm run dev, Ctrl+C en la terminal
```

### Paso 2: Aplicar la migración de cajas persistentes (si aún no se corrió)

```bash
# Backup primero
sqlcmd -S "TheBeast\SQLEXPRESS" -d SesamoDB -U sa -P "NewPasswordSql*" -C -Q "
BACKUP DATABASE SesamoDB TO DISK = 'C:\backups\SesamoDB_pre_cajas_persistentes.bak'
"

# Ejecutar el script completo
sqlcmd -S "TheBeast\SQLEXPRESS" -d SesamoDB -U sa -P "NewPasswordSql*" -h -1 -W -C -i "database\Updates\migrar-cajas-persistentes-completo.sql"
```

El script es **idempotente** en sus partes críticas: corre las FASES 2.7 y 2.8 que detectan y corrigen automáticamente:

- **FASE 2.7**: reasigna `MOVIMIENTOS_CAJA.CAJA_ID` al consolidado. Detecta tanto el caso de migración inicial como el retroactivo (cuando las cajas viejas ya fueron borradas y los `CAJA_ID` quedaron huérfanos).
- **FASE 2.8**: corrige `CAJA_ITEMS.SESION_ID` por fecha. Cada item.VENTA se asigna a la sesión cuya apertura ≤ fecha del item ≤ cierre.

Ambas fases usan `WHERE ... <> ...` o `WHERE NOT EXISTS` para no duplicar trabajo si se corren múltiples veces.

### Paso 3: Validar el resultado

```sql
-- Estas queries deben devolver 0 filas

-- a) MOVIMIENTOS_CAJA huérfanos (CAJA_ID que no existe)
SELECT COUNT(*) FROM MOVIMIENTOS_CAJA mc
WHERE mc.CAJA_ID IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID);
-- Esperado: 0

-- b) CAJA_ITEMS.VENTA en sesión incorrecta
SELECT COUNT(*) FROM CAJA_ITEMS ci
WHERE ci.ORIGEN_TIPO = 'VENTA'
  AND ci.SESION_ID <> (
    SELECT TOP 1 cs.SESION_ID FROM CAJA_SESIONES cs
    WHERE cs.FECHA_APERTURA <= ci.FECHA
      AND (cs.FECHA_CIERRE IS NULL OR cs.FECHA_CIERRE >= ci.FECHA)
    ORDER BY cs.SESION_ID DESC
  );
-- Esperado: 0

-- c) Consistencia BALANCE = SUM métodos
DECLARE @balance DECIMAL(18,2), @sum_metodos DECIMAL(18,2);
SELECT @balance = SUM(TOTAL) FROM MOVIMIENTOS_CAJA
WHERE TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_CC','TRANSFERENCIA_FC','APERTURA_CAJA','DEPOSITO_FONDO','REINTEGRO_FONDO');

SELECT @sum_metodos = (
  SELECT SUM(TOTAL) FROM MOVIMIENTOS_CAJA WHERE TIPO_ENTIDAD = 'CIERRE_CAJA'
) + (
  SELECT ISNULL(SUM(mcmp.MONTO), 0) FROM MOVIMIENTOS_CAJA mc
  JOIN MOVIMIENTOS_CAJA_METODOS_PAGO mcmp ON mc.ID = mcmp.MOVIMIENTO_ID
  WHERE mc.TIPO_ENTIDAD NOT IN ('CIERRE_CAJA','TRANSFERENCIA_FC','REINTEGRO_FONDO','DEPOSITO_FONDO')
);

SELECT
  @balance AS balance,
  @sum_metodos AS suma_metodos,
  CASE WHEN @balance = @sum_metodos THEN 'OK' ELSE 'DIFIEREN' AS resultado;
-- Esperado: balance = suma_metodos
```

### Paso 4: Reiniciar el backend con el código actualizado

```bash
cd backend
npm install  # si hay dependencias nuevas
npm run dev
```

Verificar que el backend arrancó sin errores.

### Paso 5: Validar visualmente en la UI

1. Ir a `/caja-central` (Caja Central)
2. Verificar:
   - Filtro "Este mes":
     - Ingresos debe cuadrar con la grilla
     - Egresos debe cuadrar con la grilla
     - "Ver desglose" debe mostrar 3 filas (Efectivo, MercadoPago, Transferencia)
     - La suma de los 3 métodos debe igualar el balance
   - Filtro "Todas": mismos checks

3. Verificar el listado de cajas (`/caja`):
   - Debe haber 1 caja "Caja Principal BANDA NORTE"
   - El historial de sesiones debe mostrar 300+ sesiones
   - Al abrir una sesión, el desglose por método debe mostrar las ventas correctamente

---

## Troubleshooting

### "BALANCE ≠ suma de métodos"

Síntoma: La suma de los métodos en el desglose no coincide con el balance mostrado.

Diagnóstico:
```sql
SELECT
  (SELECT SUM(TOTAL) FROM MOVIMIENTOS_CAJA
   WHERE TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_CC','TRANSFERENCIA_FC','APERTURA_CAJA','DEPOSITO_FONDO','REINTEGRO_FONDO')) AS balance,
  (SELECT SUM(TOTAL) FROM MOVIMIENTOS_CAJA WHERE TIPO_ENTIDAD = 'CIERRE_CAJA') AS cierres_total,
  (SELECT ISNULL(SUM(mcmp.MONTO), 0) FROM MOVIMIENTOS_CAJA mc
   JOIN MOVIMIENTOS_CAJA_METODOS_PAGO mcmp ON mc.ID = mcmp.MOVIMIENTO_ID
   WHERE mc.TIPO_ENTIDAD NOT IN ('CIERRE_CAJA','TRANSFERENCIA_FC','REINTEGRO_FONDO','DEPOSITO_FONDO')) AS otros_metodos,
  (SELECT ISNULL(SUM(mc.EFECTIVO), 0) FROM MOVIMIENTOS_CAJA mc WHERE mc.TIPO_ENTIDAD = 'TRANSFERENCIA_FC') AS transf_fc_efectivo;
```

Solución: Re-ejecutar FASES 2.7 y 2.8 (son idempotentes).

### "Hay filas fantasma en la grilla de movimientos"

Síntoma: Aparecen filas con descripciones como "Reintegro del fondo inicial de Caja #X" o "Depósito al Fondo de Cambio" con TOTAL = $0.

Diagnóstico:
```sql
SELECT TIPO_ENTIDAD, COUNT(*) FROM MOVIMIENTOS_CAJA
WHERE TIPO_ENTIDAD IN ('DEPOSITO_FONDO','REINTEGRO_FONDO')
GROUP BY TIPO_ENTIDAD;
```

Solución: Ya está manejado. El código excluye estos tipos del listado (INTERNAL_TYPES_SQL en cajaCentral.service.ts). Si vuelven a aparecer, limpiar las transacciones manualmente.

### "El listado de cajas está vacío"

Síntoma: `/caja` no muestra la caja consolidada.

Diagnóstico:
```sql
SELECT * FROM CAJA;
SELECT * FROM CAJA_SESIONES WHERE ESTADO = 'ACTIVA';
```

Solución: La migración no se ejecutó completamente. Re-correr `migrar-cajas-persistentes-completo.sql` desde el inicio.

---

## Rollback

Si algo sale mal, restaurar el backup:
```bash
sqlcmd -S "TheBeast\SQLEXPRESS" -U sa -P "NewPasswordSql*" -C -Q "
RESTORE DATABASE SesamoDB FROM DISK = 'C:\backups\SesamoDB_pre_cajas_persistentes.bak' WITH REPLACE
"
```

---

## Changelog

- **2026-07-30**: FASE 2.7 (MOVIMIENTOS_CAJA.CAJA_ID) y FASE 2.8 (CAJA_ITEMS.SESION_ID) integradas al script principal.
- **2026-07-30**: `INTERNAL_TYPES_SQL` actualizado en `cajaCentral.service.ts` para excluir `TRANSFERENCIA_FC`.
- **2026-07-30**: Query de `getDesgloseMetodosCajaCentral` reescrita con join por SESION_ID + asignación global.