/**
 * Generic Excel Export utility — Río Gestión
 *
 * Genera un archivo XLSX (.xlsx) a partir de un set de filas + definición de
 * columnas, con encabezado estilizado (mismo look que el PDF), ajuste de ancho
 * de columnas, congelado del header y filtro automático habilitado.
 *
 * Diseñado para reutilizarse desde cualquier página con un `<Table>` de Ant
 * Design. No depende de componentes visuales, sólo de datos.
 *
 * Dependencias: xlsx (SheetJS).
 */
import * as XLSX from 'xlsx';
import { fmtNum, fmtMoney } from './format';

/* ─── Tipos públicos ─────────────────────────────────────────────── */

export interface ExcelColumn<T = any> {
  /** Título que verá el usuario en el encabezado. */
  title: string;
  /**
   * Llave (o path con puntos) en el row. Ej: 'NOMBRE', 'cliente.NOMBRE'.
   * Si se omite se debe usar `render`.
   */
  dataIndex?: string | string[];
  /**
   * Función opcional que toma el row y devuelve el valor ya formateado.
   * El valor devuelto se escribe como string en la celda, salvo que también se
   * especifique `valueOf` para devolver el valor crudo a usar en Excel.
   */
  render?: (value: any, record: T, index: number) => string | number | null | undefined;
  /**
   * Permite separar el "valor a mostrar" del "valor real" de la celda.
   * Si se define, el resultado se usa como valor crudo en la celda
   * (numérico o string), mientras que `render` controla lo que se ve.
   * Útil para que Excel pueda operar con números pero el usuario vea $ 1.234,56.
   */
  valueOf?: (record: any, index: number) => any;
  /** Ancho mínimo sugerido (en "characters") para la columna. */
  width?: number;
  /**
   * Si `true` se interpreta el valor como número y se alinea a la derecha
   * con formato es-AR.
   */
  numeric?: boolean;
  /**
   * Si `true` formatea el número con `$` (es-AR). Requiere `numeric: true`.
   */
  money?: boolean;
  /**
   * Alineación del contenido en la celda: 'left' | 'center' | 'right'.
   */
  align?: 'left' | 'center' | 'right';
}

export interface ExportExcelOptions<T = any> {
  /** Título principal. Se incluye en una primera fila de metadata. */
  title: string;
  /** Subtítulo opcional. */
  subtitle?: string;
  /** Columnas. */
  columns: ExcelColumn<T>[];
  /** Filas. */
  data: T[];
  /** Nombre del archivo (sin extensión). */
  fileName?: string;
  /** Nombre de la hoja (default: "Listado"). */
  sheetName?: string;
  /** Filas de totales al final de la tabla. */
  footerSummary?: string[][];
  /** Incluir fila de metadata con título/subtítulo (default: true). */
  includeMeta?: boolean;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function getValueByPath(row: any, path: string | string[] | undefined): any {
  if (!row || !path) return undefined;
  const parts = Array.isArray(path) ? path : String(path).split('.');
  let cur = row;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Devuelve el valor "crudo" para Excel (number / string / null). */
function getRawValue<T>(
  col: ExcelColumn<T>,
  row: T,
  index: number,
): string | number | null {
  if (col.valueOf) {
    const v = col.valueOf(row, index);
    if (v == null) return null;
    if (typeof v === 'string' || typeof v === 'number') return v;
    return String(v);
  }
  if (col.render) {
    const r = col.render(getValueByPath(row, col.dataIndex), row, index);
    if (r == null) return null;
    if (typeof r === 'string' || typeof r === 'number') return r;
    return String(r);
  }
  const raw = getValueByPath(row, col.dataIndex);
  if (raw == null) return null;
  if (col.numeric) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No';
  return String(raw);
}

/** Devuelve el valor "visual" para mostrar (formateado). */
function getDisplayValue<T>(
  col: ExcelColumn<T>,
  row: T,
  index: number,
): string {
  if (col.render) {
    const r = col.render(getValueByPath(row, col.dataIndex), row, index);
    if (r == null) return '';
    return String(r);
  }
  const raw = getValueByPath(row, col.dataIndex);
  if (raw == null) return '';
  if (col.numeric) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) {
      return col.money ? fmtMoney(n) : fmtNum(n);
    }
  }
  if (raw instanceof Date) {
    return raw.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No';
  return String(raw);
}

function defaultSheetName(): string {
  return 'Listado';
}

function buildFileName(title: string, provided?: string): string {
  if (provided) return provided;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${safe || 'listado'}_${stamp}`;
}

function estimateColWidth<T>(col: ExcelColumn<T>): number {
  const base = col.title.length;
  if (col.money || col.numeric) return Math.max(base, 16);
  return Math.max(base, 18);
}

/* ─── Implementación ─────────────────────────────────────────────── */

type Cell = { v: string | number | null; t?: string; z?: string };

/**
 * Exporta los datos a un archivo .xlsx y dispara la descarga.
 */
export function exportToExcel<T>(opts: ExportExcelOptions<T>): void {
  const {
    title, subtitle, columns, data, fileName,
    sheetName, footerSummary, includeMeta,
  } = opts;

  if (!data || data.length === 0) {
    throw new Error('No hay datos para exportar');
  }
  if (!columns || columns.length === 0) {
    throw new Error('No hay columnas para exportar');
  }

  const showMeta = includeMeta !== false;
  const rows: Cell[][] = [];
  let metaRows = 0;

  // ── Bloque de metadata (título, subtítulo, fecha) ──
  if (showMeta) {
    // Title
    const titleRow: Cell[] = [{ v: title }];
    for (let i = 1; i < columns.length; i++) titleRow.push({ v: '' });
    rows.push(titleRow);
    metaRows++;

    // Subtitle (opcional)
    if (subtitle) {
      const subRow: Cell[] = [{ v: subtitle }];
      for (let i = 1; i < columns.length; i++) subRow.push({ v: '' });
      rows.push(subRow);
      metaRows++;
    }

    // Fecha de emisión
    const dateStr = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const dateRow: Cell[] = [{ v: `Emitido: ${dateStr}` }];
    for (let i = 1; i < columns.length; i++) dateRow.push({ v: '' });
    rows.push(dateRow);
    metaRows++;

    // Fila separadora vacía
    const sepRow: Cell[] = [{ v: '' }];
    for (let i = 1; i < columns.length; i++) sepRow.push({ v: '' });
    rows.push(sepRow);
    metaRows++;
  }

  // ── Header ──
  const headerRow: Cell[] = columns.map(c => ({ v: c.title, t: 's' }));
  rows.push(headerRow);

  // ── Data ──
  data.forEach((row, idx) => {
    const dataRow: Cell[] = columns.map(col => {
      const raw = getRawValue(col, row, idx);
      if (col.numeric && typeof raw === 'number' && Number.isFinite(raw)) {
        const z = col.money ? '"$"#,##0.00' : '#,##0.00';
        return { v: raw, t: 'n', z };
      }
      const display = getDisplayValue(col, row, idx);
      return { v: display, t: 's' };
    });
    rows.push(dataRow);
  });

  // ── Footer summary (totales) ──
  if (footerSummary && footerSummary.length > 0) {
    footerSummary.forEach((row) => {
      const out: Cell[] = columns.map((_, ci) => {
        const v = row[ci];
        return { v: v == null ? '' : String(v), t: 's' };
      });
      rows.push(out);
    });
  }

  // ── Worksheet ──
  const ws: XLSX.WorkSheet = {};
  const range = { s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: columns.length - 1 } };

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      ws[ref] = cell;
    });
  });
  ws['!ref'] = XLSX.utils.encode_range(range);

  // Anchos
  ws['!cols'] = columns.map(c => ({ wch: c.width ?? estimateColWidth(c) }));

  // Merges (título y subtítulo en la primera fila de metadata)
  if (showMeta && columns.length > 1) {
    const merges: XLSX.Range[] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } },
    ];
    // Fila 1: subtítulo (si hay) o fecha de emisión
    // Fila 2: fecha de emisión (si hay subtítulo) o separador
    // Fila 3: separador (si hay subtítulo + fecha)
    if (subtitle) {
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: columns.length - 1 } });
      merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: columns.length - 1 } });
    } else {
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: columns.length - 1 } });
    }
    ws['!merges'] = merges;
  }

  // Autofilter sobre el header
  if (columns.length > 0) {
    const headerRowIndex = metaRows;
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRowIndex, c: 0 },
        e: { r: headerRowIndex, c: columns.length - 1 },
      }),
    };
  }

  // Freeze rows
  ws['!freeze'] = { xSplit: 0, ySplit: metaRows + 1 } as any;

  // ── Workbook ──
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || defaultSheetName());

  XLSX.writeFile(wb, `${buildFileName(title, fileName)}.xlsx`);
}
