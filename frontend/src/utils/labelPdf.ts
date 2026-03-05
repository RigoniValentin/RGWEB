// ═══════════════════════════════════════════════════
//  Price Label PDF Generator
//  Generates PDF labels in A4 (2/3/4 columns) and 80mm thermal formats
// ═══════════════════════════════════════════════════

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';

// ── Types ────────────────────────────────────────
export interface LabelProduct {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  LISTA_1: number;
  LISTA_2: number;
  LISTA_3: number;
  LISTA_4: number;
  LISTA_5: number;
  LISTA_DEFECTO: number | null;
  CODIGO_BARRAS: string | null;
  CATEGORIA_NOMBRE: string | null;
}

export type LabelFormat = 'estandar' | 'compacto' | 'grande';

export interface LabelConfig {
  format: LabelFormat;
  listaPrecios: number;        // 1-5
  showBarcode: boolean;
}

// ── Helpers ──────────────────────────────────────
function getPrice(product: LabelProduct, lista: number): number {
  switch (lista) {
    case 1: return product.LISTA_1;
    case 2: return product.LISTA_2;
    case 3: return product.LISTA_3;
    case 4: return product.LISTA_4;
    case 5: return product.LISTA_5;
    default: return product.LISTA_1;
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function generateBarcodeDataURL(data: string, _width: number, height: number): string | null {
  if (!data || !data.trim()) return null;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, data, {
      format: 'CODE128',
      width: 1.5,
      height,
      displayValue: true,
      fontSize: 10,
      margin: 2,
      background: '#FFFFFF',
      lineColor: '#000000',
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

// ── Format config ────────────────────────────────
interface FormatConfig {
  columns: number;
  labelW: number;     // mm
  labelH: number;     // mm
  fontSize: { code: number; name: number; price: number; barcode: number };
  maxChars: number;
  barcodeH: number;   // mm
  gap: number;        // mm horizontal gap
  vGap: number;       // mm vertical gap
}

function getFormatConfig(format: LabelFormat, showBarcode: boolean): FormatConfig {
  switch (format) {
    case 'compacto':
      return {
        columns: 4,
        labelW: 47,
        labelH: showBarcode ? 48 : 38,
        fontSize: { code: 6, name: showBarcode ? 8 : 9, price: 12, barcode: 6 },
        maxChars: showBarcode ? 45 : 65,
        barcodeH: 18,
        gap: 3,
        vGap: 3,
      };
    case 'grande':
      return {
        columns: 2,
        labelW: 92,
        labelH: showBarcode ? 56 : 46,
        fontSize: { code: 7, name: showBarcode ? 11 : 13, price: 16, barcode: 7 },
        maxChars: showBarcode ? 70 : 100,
        barcodeH: 22,
        gap: 6,
        vGap: 4,
      };
    default: // estandar (3 columnas)
      return {
        columns: 3,
        labelW: 62,
        labelH: showBarcode ? 52 : 42,
        fontSize: { code: 6.5, name: showBarcode ? 9 : 11, price: 14, barcode: 6.5 },
        maxChars: showBarcode ? 55 : 80,
        barcodeH: 20,
        gap: 4,
        vGap: 3.5,
      };
  }
}

// ═══════════════════════════════════════════════════
//  A4 PDF Generation
// ═══════════════════════════════════════════════════
export function generateA4PDF(products: LabelProduct[], config: LabelConfig): jsPDF {
  const fmt = getFormatConfig(config.format, config.showBarcode);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = 210;
  const pageH = 297;
  const marginTop = 10;
  const totalW = fmt.columns * fmt.labelW + (fmt.columns - 1) * fmt.gap;
  const marginLeft = (pageW - totalW) / 2;

  let col = 0;
  let row = 0;
  let page = 0;

  products.forEach((product) => {
    const x = marginLeft + col * (fmt.labelW + fmt.gap);
    const y = marginTop + row * (fmt.labelH + fmt.vGap);

    // Check if we need a new page
    if (y + fmt.labelH > pageH - 8) {
      doc.addPage();
      page++;
      col = 0;
      row = 0;
      const newX = marginLeft + col * (fmt.labelW + fmt.gap);
      const newY = marginTop + row * (fmt.labelH + fmt.vGap);
      drawLabel(doc, product, newX, newY, fmt, config);
    } else {
      drawLabel(doc, product, x, y, fmt, config);
    }

    col++;
    if (col >= fmt.columns) {
      col = 0;
      row++;
    }
  });

  return doc;
}

function drawLabel(
  doc: jsPDF,
  product: LabelProduct,
  x: number,
  y: number,
  fmt: FormatConfig,
  config: LabelConfig,
) {
  const precio = getPrice(product, config.listaPrecios);
  const nombre = truncate(product.NOMBRE || '', fmt.maxChars);

  // ── Header background (drawn first, below border) ──
  const headerH = 6;
  doc.setFillColor(240, 240, 240);
  doc.rect(x, y, fmt.labelW, headerH + 1, 'F');

  // ── Outer border (drawn on top of fill) ──
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, fmt.labelW, fmt.labelH, 1.5, 1.5, 'S');

  // ── Separator line below header ──
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.line(x, y + headerH + 1, x + fmt.labelW, y + headerH + 1);

  // ── Header text ──
  doc.setFontSize(fmt.fontSize.code);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  const codText = `CÓD: ${product.CODIGOPARTICULAR || 'S/C'}`;
  doc.text(codText, x + fmt.labelW / 2, y + headerH / 2 + 1.2, { align: 'center' });

  // ── Product name ──
  let currentY = y + headerH + 3;
  doc.setFontSize(fmt.fontSize.name);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 31, 35);

  const nameMaxW = fmt.labelW - 6;
  const nameLines = doc.splitTextToSize(nombre, nameMaxW);
  const maxLines = config.showBarcode ? 2 : 3;
  const displayLines = nameLines.slice(0, maxLines);
  const lineHeight = fmt.fontSize.name * 0.4;

  displayLines.forEach((line: string) => {
    doc.text(line, x + fmt.labelW / 2, currentY + lineHeight, { align: 'center' });
    currentY += lineHeight + 0.8;
  });

  // ── Barcode ──
  if (config.showBarcode && product.CODIGO_BARRAS) {
    currentY += 1;
    const barcodeDataURL = generateBarcodeDataURL(product.CODIGO_BARRAS, 200, 50);
    if (barcodeDataURL) {
      const barcodeW = fmt.labelW - 12;
      const barcodeX = x + (fmt.labelW - barcodeW) / 2;
      try {
        doc.addImage(barcodeDataURL, 'PNG', barcodeX, currentY, barcodeW, fmt.barcodeH);
      } catch { /* barcode rendering failed, skip */ }
    } else {
      // Fallback: print barcode text
      doc.setFontSize(fmt.fontSize.barcode);
      doc.setFont('courier', 'normal');
      doc.setTextColor(60, 60, 60);
      doc.text(product.CODIGO_BARRAS, x + fmt.labelW / 2, currentY + fmt.barcodeH / 2, { align: 'center' });
    }
  }

  // ── Price banner ──
  const priceH = config.format === 'grande' ? 14 : 12;
  const priceY = y + fmt.labelH - priceH - 1.5;

  // Double border effect
  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.roundedRect(x + 2, priceY, fmt.labelW - 4, priceH, 1, 1, 'S');
  doc.setLineWidth(0.2);
  doc.roundedRect(x + 3.5, priceY + 1.2, fmt.labelW - 7, priceH - 2.4, 0.5, 0.5, 'S');

  doc.setFontSize(fmt.fontSize.price);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(formatCurrency(precio), x + fmt.labelW / 2, priceY + priceH / 2 + 1.5, { align: 'center' });
}

// ═══════════════════════════════════════════════════
//  80mm Thermal PDF Generation
// ═══════════════════════════════════════════════════
export function generate80mmPDF(products: LabelProduct[], config: LabelConfig): jsPDF {
  // 80mm paper = ~72mm printable area
  const paperW = 80;
  const printW = 72;
  const marginLeft = (paperW - printW) / 2;
  const labelH = config.showBarcode ? 46 : 36;
  const gap = 3;

  // Calculate page height
  const totalH = products.length * (labelH + gap) + 10;
  const pageH = Math.max(totalH, 50);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [paperW, pageH],
  });

  let currentY = 5;

  products.forEach((product) => {
    const precio = getPrice(product, config.listaPrecios);
    const nombre = truncate(product.NOMBRE || '', config.showBarcode ? 70 : 120);

    // ── Header background (drawn first) ──
    const headerH = 5.5;
    doc.setFillColor(240, 240, 240);
    doc.rect(marginLeft, currentY, printW, headerH + 1, 'F');

    // ── Outer border (drawn on top) ──
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginLeft, currentY, printW, labelH, 1.5, 1.5, 'S');

    // ── Separator line below header ──
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.line(marginLeft, currentY + headerH + 1, marginLeft + printW, currentY + headerH + 1);

    // ── Header text ──
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(`CÓD: ${product.CODIGOPARTICULAR || 'S/C'}`, marginLeft + printW / 2, currentY + headerH / 2 + 1, { align: 'center' });

    let innerY = currentY + headerH + 2.5;

    // ── Name ──
    doc.setFontSize(config.showBarcode ? 10 : 12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 31, 35);

    const nameLines = doc.splitTextToSize(nombre, printW - 8);
    const maxLines = config.showBarcode ? 2 : 3;
    const displayLines = nameLines.slice(0, maxLines);
    const lh = (config.showBarcode ? 10 : 12) * 0.4;

    displayLines.forEach((line: string) => {
      doc.text(line, marginLeft + printW / 2, innerY + lh, { align: 'center' });
      innerY += lh + 0.8;
    });

    // ── Barcode ──
    if (config.showBarcode && product.CODIGO_BARRAS) {
      innerY += 1;
      const barcodeDataURL = generateBarcodeDataURL(product.CODIGO_BARRAS, 200, 50);
      if (barcodeDataURL) {
        const bw = printW - 14;
        const bx = marginLeft + (printW - bw) / 2;
        try {
          doc.addImage(barcodeDataURL, 'PNG', bx, innerY, bw, 14);
        } catch { /* skip */ }
      }
    }

    // ── Price ──
    const priceH = 11;
    const priceY = currentY + labelH - priceH - 1.5;

    doc.setDrawColor(0);
    doc.setLineWidth(0.6);
    doc.roundedRect(marginLeft + 2, priceY, printW - 4, priceH, 1, 1, 'S');
    doc.setLineWidth(0.2);
    doc.roundedRect(marginLeft + 3.5, priceY + 1, printW - 7, priceH - 2, 0.5, 0.5, 'S');

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(formatCurrency(precio), marginLeft + printW / 2, priceY + priceH / 2 + 1.5, { align: 'center' });

    currentY += labelH + gap;
  });

  return doc;
}
