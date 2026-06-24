/**
 * Generic PDF Export utility — Río Gestión
 *
 * Genera un PDF A4 (portrait o landscape, auto) con un encabezado profesional,
 * una grilla tabular completa, paginación automática y pie de página.
 *
 * Diseñado para reutilizarse desde cualquier página con un `<Table>` de Ant Design.
 * No depende de componentes visuales, sólo de datos.
 *
 * Dependencias: jspdf (ya en el proyecto).
 */
import { jsPDF } from 'jspdf';
import { fmtNum, fmtMoney } from './format';

/* ─── Tipos públicos ─────────────────────────────────────────────── */

export interface PdfColumn<T = any> {
  /** Título que verá el usuario en el encabezado. */
  title: string;
  /**
   * Llave (o path con puntos) en el row. Ej: 'NOMBRE', 'cliente.NOMBRE'.
   * Si se omite se debe usar `render`.
   */
  dataIndex?: string | string[];
  /**
   * Función opcional que toma el row y devuelve el valor ya formateado.
   * Si está presente, gana por sobre dataIndex.
   */
  render?: (value: any, record: T, index: number) => string | number | null | undefined;
  /** Alineación de la columna: 'left' | 'center' | 'right'. */
  align?: 'left' | 'center' | 'right';
  /** Ancho relativo o absoluto. Si se omite se reparte lo que queda. */
  width?: number;
  /**
   * Si `true` se interpreta el valor como número y se alinea a la derecha
   * con formato es-AR. Útil para montos y cantidades sin tener que usar `render`.
   */
  numeric?: boolean;
  /**
   * Si `true` formatea el número con `$` (es-AR). Requiere `numeric: true`.
   */
  money?: boolean;
}

export interface ExportPdfOptions<T = any> {
  /** Título principal (encabezado del PDF, también se usa para el fileName). */
  title: string;
  /** Subtítulo opcional (debajo del título). Útil para filtros aplicados. */
  subtitle?: string;
  /** Listado de columnas a exportar. */
  columns: PdfColumn<T>[];
  /** Filas a exportar. */
  data: T[];
  /** Nombre del archivo (sin extensión). */
  fileName?: string;
  /** Orientación forzada. Si se omite, se auto-detecta. */
  orientation?: 'portrait' | 'landscape';
  /** Nombre de fantasía de la empresa (encabezado superior). */
  companyName?: string;
  /** Información adicional a mostrar bajo el subtítulo (ej: rango de fechas). */
  meta?: string;
  /** Filas de totales al pie de la tabla (cada item = una fila). */
  footerSummary?: string[][];
}

/* ─── Helpers internos ───────────────────────────────────────────── */

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

function formatCell<T>(
  col: PdfColumn<T>,
  row: T,
  index: number,
): string {
  // 1) render() personalizado gana
  if (col.render) {
    const raw = col.render(getValueByPath(row, col.dataIndex), row, index);
    if (raw == null) return '';
    return String(raw);
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
  return String(raw);
}

function defaultCompanyName(): string {
  return 'Río Gestión';
}

/* ─── Implementación ─────────────────────────────────────────────── */

const COLORS = {
  primary: [30, 31, 34] as [number, number, number],   // rg-black
  gold: [234, 189, 35] as [number, number, number],    // rg-gold
  goldDark: [212, 167, 32] as [number, number, number],
  headerBg: [30, 31, 34] as [number, number, number],
  headerText: [234, 189, 35] as [number, number, number],
  zebra: [248, 248, 250] as [number, number, number],
  border: [220, 220, 224] as [number, number, number],
  bodyText: [33, 33, 33] as [number, number, number],
  muted: [120, 120, 120] as [number, number, number],
};

/** Decide orientación según la cantidad de columnas y el ancho total estimado. */
function chooseOrientation<T>(cols: PdfColumn<T>[]): 'portrait' | 'landscape' {
  if (cols.length >= 7) return 'landscape';
  if (cols.length >= 5) {
    const totalExplicit = cols.reduce((s, c) => s + (c.width ?? 0), 0);
    if (totalExplicit > 100) return 'landscape';
  }
  return 'portrait';
}

/** Trunca un texto para que entre en un ancho dado (en mm) con la fuente actual. */
function truncate(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.getTextWidth(text.slice(0, mid) + ellipsis) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

/** Genera un nombre de archivo seguro basado en el título y la fecha. */
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

/**
 * Exporta a PDF en A4 con encabezado, grilla, paginación y pie.
 */
export function exportToPdf<T>(opts: ExportPdfOptions<T>): void {
  const {
    title, subtitle, columns, data, fileName,
    orientation, companyName, meta, footerSummary,
  } = opts;

  if (!data || data.length === 0) {
    throw new Error('No hay datos para exportar');
  }
  if (!columns || columns.length === 0) {
    throw new Error('No hay columnas para exportar');
  }

  const orient = orientation ?? chooseOrientation(columns);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orient });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const marginTop = 14;
  const marginBottom = 16;
  const contentW = pageW - marginX * 2;

  // ── Distribución de anchos de columna ──
  const explicitTotal = columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const widths: number[] = [];
  if (explicitTotal > 0) {
    const scale = contentW / explicitTotal;
    columns.forEach(c => widths.push((c.width ?? 0) * scale));
    const drift = contentW - widths.reduce((s, w) => s + w, 0);
    if (widths.length > 0) widths[widths.length - 1] = (widths[widths.length - 1] ?? 0) + drift;
  } else {
    const totalW = columns.reduce((s, c) => {
      if (c.numeric) return s + 0.9;
      if (c.align === 'center') return s + 0.9;
      return s + 1.4;
    }, 0);
    columns.forEach(c => {
      const w = c.numeric ? 0.9 : (c.align === 'center' ? 0.9 : 1.4);
      widths.push((w / totalW) * contentW);
    });
  }

  /* ── Encabezado de página (se repite en cada página) ── */
  const drawHeader = (firstPage: boolean) => {
    const yStart = marginTop;

    doc.setFillColor(...COLORS.primary);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...COLORS.gold);
    doc.rect(0, 18, pageW, 1.2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(companyName || defaultCompanyName(), marginX, 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const dateStr = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    doc.text(`Emitido: ${dateStr}`, pageW - marginX, 11, { align: 'right' });

    if (firstPage) {
      doc.setTextColor(...COLORS.bodyText);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text(title, marginX, yStart + 12);

      if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...COLORS.muted);
        doc.text(subtitle, marginX, yStart + 18);
      }
      if (meta) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...COLORS.muted);
        const metaY = subtitle ? yStart + 23 : yStart + 18;
        doc.text(meta, marginX, metaY);
      }
    }

    if (firstPage) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...COLORS.gold);
      const totalY = subtitle ? yStart + 18 : yStart + 12;
      doc.text(`${data.length} registro${data.length === 1 ? '' : 's'}`, pageW - marginX, totalY, { align: 'right' });
    }
  };

  /* ── Tabla ── */
  const rowHeight = 7;
  const headerHeight = 8;
  const firstTableY = subtitle
    ? marginTop + 32
    : marginTop + 22;

  const drawTableHeader = (y: number): number => {
    doc.setFillColor(...COLORS.headerBg);
    doc.rect(marginX, y, contentW, headerHeight, 'F');

    doc.setTextColor(...COLORS.headerText);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);

    let x = marginX;
    columns.forEach((col, i) => {
      const w = widths[i] ?? 0;
      const align = col.align ?? (col.numeric ? 'right' : 'left');
      const text = col.title;
      const truncated = truncate(doc, text, w - 4);
      const tx = align === 'right'
        ? x + w - 2
        : align === 'center'
          ? x + w / 2
          : x + 2;
      doc.text(truncated, tx, y + 5.5, { align: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left' });
      x += w;
    });
    return y + headerHeight;
  };

  const getColAlign = (i: number): 'left' | 'center' | 'right' => {
    const col = columns[i];
    return col?.align ?? (col?.numeric ? 'right' : 'left');
  };

  let y = firstTableY;
  drawHeader(true);
  y = drawTableHeader(y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.bodyText);

  data.forEach((row, idx) => {
    if (y + rowHeight > pageH - marginBottom) {
      doc.addPage();
      drawHeader(false);
      y = marginTop + 4;
      y = drawTableHeader(y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.bodyText);
    }

    if (idx % 2 === 1) {
      doc.setFillColor(...COLORS.zebra);
      doc.rect(marginX, y, contentW, rowHeight, 'F');
    }

    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.1);
    doc.line(marginX, y + rowHeight, marginX + contentW, y + rowHeight);

    let x = marginX;
    columns.forEach((col, i) => {
      const w = widths[i] ?? 0;
      const align = getColAlign(i);
      const text = formatCell(col, row, idx);
      const truncated = truncate(doc, text, w - 4);
      const tx = align === 'right'
        ? x + w - 2
        : align === 'center'
          ? x + w / 2
          : x + 2;
      doc.text(truncated, tx, y + 5, { align: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left' });
      x += w;
    });

    y += rowHeight;
  });

  // ── Footer summary (totales) ──
  if (footerSummary && footerSummary.length > 0) {
    if (y + rowHeight * footerSummary.length + 6 > pageH - marginBottom) {
      doc.addPage();
      drawHeader(false);
      y = marginTop + 4;
    }
    y += 2;
    doc.setFillColor(245, 245, 245);
    doc.rect(marginX, y, contentW, rowHeight * footerSummary.length, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.bodyText);
    footerSummary.forEach((row) => {
      let xCursor = marginX;
      row.forEach((cell, ci) => {
        const colIndex = ci < columns.length ? ci : 0;
        const w = widths[colIndex] ?? contentW;
        const align = getColAlign(colIndex);
        const tx = align === 'right' ? xCursor + w - 2 : align === 'center' ? xCursor + w / 2 : xCursor + 2;
        doc.text(String(cell), tx, y + 5.5, { align: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left' });
        xCursor += w;
      });
      y += rowHeight;
    });
  }

  /* ── Pie de página en cada página ── */
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageH - marginBottom + 4, pageW - marginX, pageH - marginBottom + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text('Río Gestión · Reporte generado automáticamente', marginX, pageH - marginBottom + 9);
    doc.text(`Página ${p} de ${totalPages}`, pageW - marginX, pageH - marginBottom + 9, { align: 'right' });
  }

  doc.save(`${buildFileName(title, fileName)}.pdf`);
}
