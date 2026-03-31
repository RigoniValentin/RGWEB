import jsPDF from 'jspdf';
import type { RemitoDetalle, EmpresaData } from '../../types';
import dayjs from 'dayjs';

export type CopiasTipo = 'original' | 'original-duplicado';

/**
 * Generates a Remito PDF in A4 format, styled like an Argentine fiscal invoice.
 * @param copias - 'original' for one copy, 'original-duplicado' for two pages.
 */
export function generateRemitoPdf(
  remito: RemitoDetalle,
  empresa: EmpresaData,
  copias: CopiasTipo = 'original',
  logoDataUrl?: string | null,
) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const copies = copias === 'original-duplicado'
    ? ['ORIGINAL', 'DUPLICADO'] as const
    : ['ORIGINAL'] as const;

  for (let c = 0; c < copies.length; c++) {
    if (c > 0) doc.addPage();
    renderRemitoCopy(doc, remito, empresa, copies[c]!, logoDataUrl);
  }

  const filename = `Remito_${remito.TIPO}_${remito.PTO_VTA}-${remito.NRO_REMITO}.pdf`;
  doc.save(filename);
}

// ── Helpers ─────────────────────────────────────────

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtDate = (d: string) => dayjs(d).format('DD/MM/YYYY');

const BLACK = '#000000';

function renderRemitoCopy(
  doc: jsPDF,
  remito: RemitoDetalle,
  empresa: EmpresaData,
  copyLabel: string,
  logoDataUrl?: string | null,
) {
  const pageW = 210;
  const marginL = 12;
  const contentW = pageW - marginL - 12;
  const centerX = pageW / 2;
  const rightStart = centerX + 12; // start of right side content

  // ┌─────────────────────────────────────────────────────────┐
  // │ HEADER — copy label (ORIGINAL / DUPLICADO)              │
  // └─────────────────────────────────────────────────────────┘
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.rect(marginL, 8, contentW, 12);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLACK);
  doc.text(copyLabel, centerX, 16, { align: 'center' });

  // ┌──────────────────────┬───┬──────────────────────────────┐
  // │ Company info (left)  │ R │  REMITO + numbering (right)  │
  // └──────────────────────┴───┴──────────────────────────────┘
  const headerTop = 20;
  const headerH = 42;
  doc.setLineWidth(0.5);
  doc.rect(marginL, headerTop, contentW, headerH);

  // Vertical divider line
  doc.line(centerX, headerTop, centerX, headerTop + headerH);

  // ── Center letter box "R" ──
  const letterBoxSize = 16;
  const letterBoxX = centerX - letterBoxSize / 2;
  const letterBoxY = headerTop;
  doc.setFillColor('#FFFFFF');
  doc.rect(letterBoxX, letterBoxY, letterBoxSize, letterBoxSize, 'FD');
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('R', centerX, letterBoxY + 12, { align: 'center' });
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('NO FISCAL', centerX, letterBoxY + 15.5, { align: 'center' });

  // Helper: draw bold label + normal value, value starts right after label
  const labelValue = (x: number, y: number, label: string, value: string, fontSize = 8) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    doc.text(label, x, y);
    const labelW = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal');
    doc.text(value, x + labelW + 1, y);
  };

  // ── Left side: logo + company info ──
  const lx = marginL + 3;
  let ly = headerTop + 22; // start below R box

  // Logo (if available)
  if (logoDataUrl) {
    try {
      const logoMaxW = 30;
      const logoMaxH = 18;
      const props = doc.getImageProperties(logoDataUrl);
      const ratio = props.width / props.height;
      let w: number, h: number;
      if (logoMaxW / logoMaxH > ratio) {
        h = logoMaxH;
        w = h * ratio;
      } else {
        w = logoMaxW;
        h = w / ratio;
      }
      doc.addImage(logoDataUrl, lx, headerTop + 2, w, h);
      ly = headerTop + 2 + h + 4;
    } catch { /* ignore if image fails */ }
  }

  const domicilio = empresa.DOMICILIO
    ? `${empresa.DOMICILIO}${empresa.LOCALIDAD ? ' - ' + empresa.LOCALIDAD : ''}`
    : '';

  labelValue(lx, ly, 'Razón Social: ', (empresa.RAZON_SOCIAL || empresa.NOMBRE_FANTASIA || '').substring(0, 45));
  ly += 5;
  if (empresa.CUIT) {
    labelValue(lx, ly, 'CUIT: ', empresa.CUIT);
    ly += 5;
  }
  labelValue(lx, ly, 'Condición frente al IVA: ', empresa.CONDICION_IVA || '');
  ly += 5;
  labelValue(lx, ly, 'Domicilio Comercial: ', domicilio.substring(0, 50));

  // ── Right side: REMITO title + numbering ──
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLACK);
  doc.text('REMITO', rightStart, headerTop + 9);

  const ptoVta = String(remito.PTO_VTA).padStart(5, '0');
  const nroComp = String(remito.NRO_REMITO).padStart(8, '0');

  let ry = headerTop + 17;
  labelValue(rightStart, ry, 'Punto de Venta: ', ptoVta);
  const pvEnd = rightStart + doc.getTextWidth('Punto de Venta: ') + doc.getTextWidth(ptoVta) + 6;
  labelValue(pvEnd, ry, 'Comp. Nro: ', nroComp);

  ry += 5;
  labelValue(rightStart, ry, 'Fecha de Emisión: ', fmtDate(remito.FECHA));

  ry += 5;
  if (empresa.CUIT) {
    labelValue(rightStart, ry, 'CUIT: ', empresa.CUIT);
  }

  ry += 5;
  if (empresa.INGRESOS_BRUTOS) {
    labelValue(rightStart, ry, 'Ingresos Brutos: ', empresa.INGRESOS_BRUTOS);
  }

  ry += 5;
  if (empresa.INICIO_ACTIVIDADES) {
    labelValue(rightStart, ry, 'Inicio de Actividades: ', empresa.INICIO_ACTIVIDADES);
  }

  // ┌─────────────────────────────────────────────────────────┐
  // │ DESTINATARIO / ORIGEN — all rows left-aligned           │
  // └─────────────────────────────────────────────────────────┘
  const destTop = headerTop + headerH + 1;

  const destinatarioNombre = remito.CLIENTE_NOMBRE || remito.PROVEEDOR_NOMBRE || '-';
  const destinatarioDomicilio = remito.CLIENTE_DOMICILIO || remito.PROVEEDOR_DOMICILIO || '';
  const destinatarioDoc = remito.CLIENTE_NUMERO_DOC || remito.PROVEEDOR_NUMERO_DOC || '';
  const condicionIva = remito.CLIENTE_CONDICION_IVA || '';

  doc.setFontSize(8);
  const destRightCol = centerX + 3; // right column start
  let dy = destTop + 5;

  // Row 1: Razón Social (left) | Condición frente al IVA (right)
  labelValue(lx, dy, 'Razón Social: ', (destinatarioNombre || '-').substring(0, 45));
  labelValue(destRightCol, dy, 'Condición frente al IVA: ', condicionIva || '-');

  // Row 2: CUIT (left) | Domicilio (right)
  dy += 5;
  labelValue(lx, dy, 'CUIT: ', destinatarioDoc || '-');
  labelValue(destRightCol, dy, 'Domicilio Comercial: ', (destinatarioDomicilio || '-').substring(0, 45));

  // Row 4: Observaciones (full width, wrapping)
  if (remito.OBSERVACIONES) {
    dy += 5;
    const obsLabel = 'Observaciones: ';
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(obsLabel, lx, dy);
    const obsLabelW = doc.getTextWidth(obsLabel);
    doc.setFont('helvetica', 'normal');
    const maxObsW = marginL + contentW - lx - obsLabelW - 3;
    const obsLines: string[] = doc.splitTextToSize(remito.OBSERVACIONES, maxObsW);
    doc.text(obsLines[0]!, lx + obsLabelW + 1, dy);
    for (let ol = 1; ol < obsLines.length; ol++) {
      dy += 4;
      doc.text(obsLines[ol]!, lx + obsLabelW + 1, dy);
    }
  }

  dy += 5;

  const destH = dy - destTop + 1;
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.3);
  doc.rect(marginL, destTop, contentW, destH);

  // ┌─────────────────────────────────────────────────────────┐
  // │ ITEMS TABLE                                             │
  // └─────────────────────────────────────────────────────────┘
  const tableTop = destTop + destH + 2;
  const colWidths = {
    codigo: 28,
    producto: contentW - 28 - 22 - 22 - 28 - 28,
    cantidad: 22,
    uMedida: 22,
    precioUnit: 28,
    subtotal: 28,
  };
  const colPositions = {
    codigo: marginL,
    producto: marginL + colWidths.codigo,
    cantidad: marginL + colWidths.codigo + colWidths.producto,
    uMedida: marginL + colWidths.codigo + colWidths.producto + colWidths.cantidad,
    precioUnit: marginL + colWidths.codigo + colWidths.producto + colWidths.cantidad + colWidths.uMedida,
    subtotal: marginL + contentW - colWidths.subtotal,
  };

  // Table header
  const thH = 8;
  doc.setFillColor('#e8e8e8');
  doc.rect(marginL, tableTop, contentW, thH, 'FD');
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.3);

  // Column header vertical lines
  doc.line(colPositions.producto, tableTop, colPositions.producto, tableTop + thH);
  doc.line(colPositions.cantidad, tableTop, colPositions.cantidad, tableTop + thH);
  doc.line(colPositions.uMedida, tableTop, colPositions.uMedida, tableTop + thH);
  doc.line(colPositions.precioUnit, tableTop, colPositions.precioUnit, tableTop + thH);
  doc.line(colPositions.subtotal, tableTop, colPositions.subtotal, tableTop + thH);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLACK);
  const thY = tableTop + 5.5;
  doc.text('Código', colPositions.codigo + 2, thY);
  doc.text('Producto / Servicio', colPositions.producto + 2, thY);
  doc.text('Cantidad', colPositions.cantidad + colWidths.cantidad / 2, thY, { align: 'center' });
  doc.text('U. medida', colPositions.uMedida + colWidths.uMedida / 2, thY, { align: 'center' });
  doc.text('Precio Unit.', colPositions.precioUnit + colWidths.precioUnit / 2, thY, { align: 'center' });
  doc.text('Subtotal', colPositions.subtotal + colWidths.subtotal / 2, thY, { align: 'center' });

  // Table body
  let y = tableTop + thH;
  const rowH = 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);

  const items = remito.items;
  const maxBodyY = 230;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (y + rowH > maxBodyY) {
      // Bottom border on current page
      doc.setDrawColor(BLACK);
      doc.setLineWidth(0.3);
      doc.line(marginL, y, marginL + contentW, y);
      doc.addPage();
      y = 20;
      // Re-draw header on new page
      doc.setFillColor('#e8e8e8');
      doc.rect(marginL, y, contentW, thH, 'FD');
      doc.setLineWidth(0.3);
      doc.line(colPositions.producto, y, colPositions.producto, y + thH);
      doc.line(colPositions.cantidad, y, colPositions.cantidad, y + thH);
      doc.line(colPositions.uMedida, y, colPositions.uMedida, y + thH);
      doc.line(colPositions.precioUnit, y, colPositions.precioUnit, y + thH);
      doc.line(colPositions.subtotal, y, colPositions.subtotal, y + thH);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('Código', colPositions.codigo + 2, y + 5.5);
      doc.text('Producto / Servicio', colPositions.producto + 2, y + 5.5);
      doc.text('Cantidad', colPositions.cantidad + colWidths.cantidad / 2, y + 5.5, { align: 'center' });
      doc.text('U. medida', colPositions.uMedida + colWidths.uMedida / 2, y + 5.5, { align: 'center' });
      doc.text('Precio Unit.', colPositions.precioUnit + colWidths.precioUnit / 2, y + 5.5, { align: 'center' });
      doc.text('Subtotal', colPositions.subtotal + colWidths.subtotal / 2, y + 5.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      y += thH;
    }

    // Alternate row bg
    if (i % 2 === 0) {
      doc.setFillColor('#f5f5f5');
      doc.rect(marginL, y, contentW, rowH, 'F');
    }

    // Subtle bottom separator line
    doc.setDrawColor('#cccccc');
    doc.setLineWidth(0.1);
    doc.line(marginL, y + rowH, marginL + contentW, y + rowH);

    const textY = y + 5;
    doc.setTextColor(BLACK);
    doc.text(item.PRODUCTO_CODIGO || '', colPositions.codigo + 2, textY);
    doc.text((item.PRODUCTO_NOMBRE || '').substring(0, 55), colPositions.producto + 2, textY);
    doc.text(fmtMoney(item.CANTIDAD), colPositions.cantidad + colWidths.cantidad - 3, textY, { align: 'right' });
    doc.text(item.UNIDAD_ABREVIACION || 'u', colPositions.uMedida + colWidths.uMedida / 2, textY, { align: 'center' });
    doc.text(fmtMoney(item.PRECIO_UNITARIO), colPositions.precioUnit + colWidths.precioUnit - 3, textY, { align: 'right' });
    doc.text(fmtMoney(item.TOTAL_PRODUCTO), colPositions.subtotal + colWidths.subtotal - 3, textY, { align: 'right' });

    y += rowH;
  }

  // Bottom border line for items table
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.3);
  doc.line(marginL, y, marginL + contentW, y);

  // ┌─────────────────────────────────────────────────────────┐
  // │ TOTALS BOX (bottom area, like factura)                  │
  // └─────────────────────────────────────────────────────────┘
  const totalsTop = Math.max(y + 4, 240);
  const totalsW = contentW;
  const totalsH = 30;
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.3);
  doc.rect(marginL, totalsTop, totalsW, totalsH);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(BLACK);

  const rightCol = marginL + totalsW - 4;
  const labelCol = marginL + totalsW - 65;

  doc.setFont('helvetica', 'bold');
  doc.text('Subtotal: $', labelCol, totalsTop + 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(fmtMoney(remito.SUBTOTAL), rightCol, totalsTop + 10, { align: 'right' });

  doc.setLineWidth(0.2);
  doc.line(labelCol - 25, totalsTop + 14, marginL + totalsW - 2, totalsTop + 14);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Importe Total: $', labelCol, totalsTop + 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(fmtMoney(remito.TOTAL), rightCol, totalsTop + 22, { align: 'right' });

  // ┌─────────────────────────────────────────────────────────┐
  // │ FOOTER — signature lines + page number                  │
  // └─────────────────────────────────────────────────────────┘
  const footerY = totalsTop + totalsH + 10;

  // Signature lines
  doc.setDrawColor('#999999');
  doc.setLineWidth(0.3);
  const sig1X = marginL + 20;
  const sig2X = marginL + contentW - 60;
  doc.line(sig1X, footerY + 10, sig1X + 50, footerY + 10);
  doc.line(sig2X, footerY + 10, sig2X + 50, footerY + 10);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#555555');
  doc.text('Firma y aclaración (Emisor)', sig1X + 25, footerY + 14, { align: 'center' });
  doc.text('Firma y aclaración (Receptor)', sig2X + 25, footerY + 14, { align: 'center' });

  // Page number
  doc.setFontSize(7);
  doc.setTextColor('#999999');
  doc.text('Pág. 1/1', centerX, 290, { align: 'center' });
}
