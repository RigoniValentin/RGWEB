import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { FacturaData, FacturaDataItem } from '../../services/sales.api';
import dayjs from 'dayjs';

export type CopiasTipo = 'original' | 'original-duplicado';

/**
 * Generates a Factura Electrónica PDF in A4 format.
 * Layout matches the official ARCA (ex-AFIP) format.
 */
export async function generateFacturaPdf(
  data: FacturaData,
  copias: CopiasTipo = 'original',
  logoDataUrl?: string | null,
) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const copies = copias === 'original-duplicado'
    ? ['ORIGINAL', 'DUPLICADO'] as const
    : ['ORIGINAL'] as const;

  const qrDataUrl = await generateQRDataUrl(data);

  for (let c = 0; c < copies.length; c++) {
    if (c > 0) doc.addPage();
    renderFacturaPage(doc, data, copies[c]!, logoDataUrl, qrDataUrl);
  }

  const ptoVta = (data.venta.PUNTO_VENTA || '00001').padStart(5, '0');
  const nro = (data.venta.NUMERO_FISCAL || '00000001').padStart(8, '0');
  const tipo = data.venta.TIPO_COMPROBANTE || 'Factura';
  const filename = `${tipo.replace('.', '')}_${ptoVta}-${nro}.pdf`;
  doc.save(filename);
}

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtDate = (d: string) => dayjs(d).format('DD/MM/YYYY');

function fmtCuit(cuit: string): string {
  const clean = (cuit || '').replace(/\D/g, '');
  if (clean.length === 11) return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
  return cuit || '';
}

function fmtFechaVto(d: string | null | undefined): string {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  const parsed = dayjs(s);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY') : s;
}

function getLetra(tipo: string): string {
  const t = (tipo || '').toUpperCase();
  const after = t.split('.').pop() || '';
  if (after.startsWith('A')) return 'A';
  if (after.startsWith('C')) return 'C';
  return 'B';
}

function getTitulo(tipo: string): string {
  const t = (tipo || '').toUpperCase();
  if (t.includes('NC') || t.includes('CRÉDITO') || t.includes('CREDITO')) return 'NOTA DE CRÉDITO';
  if (t.includes('ND') || t.includes('DÉBITO') || t.includes('DEBITO')) return 'NOTA DE DÉBITO';
  return 'FACTURA';
}

function getCodComprobante(tipo: string): string {
  const t = (tipo || '').toUpperCase();
  const letra = getLetra(tipo);
  // NC
  if (t.includes('NC') || t.includes('CRÉDITO') || t.includes('CREDITO')) {
    if (letra === 'A') return '003';
    if (letra === 'C') return '013';
    return '008';
  }
  // ND
  if (t.includes('ND') || t.includes('DÉBITO') || t.includes('DEBITO')) {
    if (letra === 'A') return '002';
    if (letra === 'C') return '012';
    return '007';
  }
  // Factura
  if (letra === 'A') return '001';
  if (letra === 'C') return '011';
  return '006';
}

function getDocTipoCode(tipoDoc: string | null): number {
  const t = (tipoDoc || '').toUpperCase().trim();
  if (t === 'CUIT') return 80;
  if (t === 'CUIL') return 86;
  if (t === 'DNI') return 96;
  return 99;
}

function itemSubtotal(item: FacturaDataItem): number {
  const unitPrice = item.PRECIO_UNITARIO_DTO != null
    ? item.PRECIO_UNITARIO_DTO
    : (item.DESCUENTO > 0
      ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
      : item.PRECIO_UNITARIO);
  return unitPrice * item.CANTIDAD;
}

function itemBonif(item: FacturaDataItem): number {
  if (item.DESCUENTO <= 0) return 0;
  return item.PRECIO_UNITARIO * item.CANTIDAD * (item.DESCUENTO / 100);
}

async function generateQRDataUrl(data: FacturaData): Promise<string | null> {
  try {
    const { venta, empresa } = data;
    const cae = venta.CAE || data.feResp?.CAE || '';
    const cleanCuit = (empresa.CUIT || '').replace(/\D/g, '');
    const ptoVta = Number(venta.PUNTO_VENTA || '1');
    const cbteTipo = Number(getCodComprobante(venta.TIPO_COMPROBANTE));
    const nroCmp = Number(venta.NUMERO_FISCAL || '1');
    const tipoDocRec = getDocTipoCode(venta.CLIENTE_TIPO_DOC);
    const nroDocRec = Number((venta.CLIENTE_NUMERO_DOC || '0').replace(/\D/g, '') || '0');
    const qrPayload = JSON.stringify({
      ver: 1,
      fecha: dayjs(venta.FECHA_VENTA).format('YYYY-MM-DD'),
      cuit: Number(cleanCuit),
      ptoVta,
      tipoCmp: cbteTipo,
      nroCmp,
      importe: venta.TOTAL,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec,
      nroDocRec,
      tipoCodAut: 'E',
      codAut: Number(cae),
    });
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(qrPayload)}`;
    return await QRCode.toDataURL(qrUrl, { width: 200, margin: 0 });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════
//  Page render (matches ARCA official layout)
// ═══════════════════════════════════════════════════

function renderFacturaPage(
  doc: jsPDF,
  data: FacturaData,
  copyLabel: string,
  logoDataUrl?: string | null,
  qrDataUrl?: string | null,
) {
  const { venta, feResp, empresa } = data;
  const PW = 210;
  const ML = 8;
  const MR = 8;
  const CW = PW - ML - MR;
  const CX = PW / 2;

  const letra = getLetra(venta.TIPO_COMPROBANTE);
  const titulo = getTitulo(venta.TIPO_COMPROBANTE);
  const ptoVta = (venta.PUNTO_VENTA || '00001').padStart(5, '0');
  const nroComp = (venta.NUMERO_FISCAL || '00000001').padStart(8, '0');
  const cae = venta.CAE || feResp?.CAE || '';
  const caeVto = feResp?.VENCIMIENTO_CAE || '';

  const domicilioEmpresa = empresa.DOMICILIO
    ? `${empresa.DOMICILIO}${empresa.LOCALIDAD ? ' - ' + empresa.LOCALIDAD : ''}`
    : '';

  // Bold label + normal value
  const lv = (x: number, y: number, label: string, value: string, fs = 8) => {
    doc.setFontSize(fs);
    doc.setFont('helvetica', 'bold');
    doc.text(label, x, y);
    const lw = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal');
    doc.text(value, x + lw, y);
  };

  doc.setDrawColor('#000000');
  doc.setTextColor('#000000');

  // ════════════════════════════════════════════════
  //  COPY LABEL (ORIGINAL / DUPLICADO / TRIPLICADO)
  // ════════════════════════════════════════════════
  const copyTop = 6;
  const copyH = 10;
  doc.setLineWidth(0.4);
  doc.rect(ML, copyTop, CW, copyH);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(copyLabel, CX, copyTop + 7, { align: 'center' });

  // ════════════════════════════════════════════════
  //  HEADER — Two columns with letter box in center
  // ════════════════════════════════════════════════
  const hTop = copyTop + copyH;
  const hH = 42;
  const halfW = CW / 2;

  doc.setLineWidth(0.4);
  doc.rect(ML, hTop, CW, hH);
  doc.line(CX, hTop, CX, hTop + hH);

  // Letter box (centered on divider)
  const lbSize = 18;
  const lbX = CX - lbSize / 2;
  const lbY = hTop;
  doc.setFillColor('#FFFFFF');
  doc.rect(lbX, lbY, lbSize, lbSize, 'FD');
  doc.setLineWidth(0.6);
  doc.rect(lbX, lbY, lbSize, lbSize);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(letra, CX, lbY + 13, { align: 'center' });
  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.text('COD. ' + getCodComprobante(venta.TIPO_COMPROBANTE), CX, lbY + 17, { align: 'center' });

  // ── LEFT: Empresa info ──
  const lx = ML + 3;
  let ly = hTop + 4;

  if (logoDataUrl) {
    try {
      const maxW = halfW - 40;
      const maxH = 14;
      const props = doc.getImageProperties(logoDataUrl);
      const ratio = props.width / props.height;
      let w: number, h: number;
      if (maxW / maxH > ratio) { h = maxH; w = h * ratio; } else { w = maxW; h = w / ratio; }
      doc.addImage(logoDataUrl, lx, ly, w, h);
      ly += h + 2;
    } catch { /* skip */ }
  }

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const displayName = empresa.NOMBRE_FANTASIA || empresa.RAZON_SOCIAL || '';
  doc.text(displayName, lx, ly + 3);
  ly += 7;
  if (empresa.NOMBRE_FANTASIA && empresa.RAZON_SOCIAL && empresa.NOMBRE_FANTASIA !== empresa.RAZON_SOCIAL) {
    lv(lx, ly, 'Razón Social: ', empresa.RAZON_SOCIAL, 7.5);
    ly += 4.5;
  }
  lv(lx, ly, 'Domicilio Comercial: ', '', 7.5);
  ly += 4;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const domLines = doc.splitTextToSize(domicilioEmpresa, halfW - 12);
  doc.text(domLines, lx + 2, ly);
  ly += domLines.length * 3.5 + 1;
  lv(lx, ly, 'Condición frente al IVA: ', empresa.CONDICION_IVA || '', 7.5);

  // ── RIGHT: FACTURA title + numbering ──
  const rx = CX + 12;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo, rx, hTop + 10);

  let ry = hTop + 18;
  doc.setFontSize(7.5);
  lv(rx, ry, 'Punto de Venta: ', ptoVta + '    ', 7.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  const pvW = doc.getTextWidth('Punto de Venta: ') + doc.getTextWidth(ptoVta + '    ');
  lv(rx + pvW, ry, 'Comp. Nro: ', nroComp, 7.5);

  ry += 5;
  lv(rx, ry, 'Fecha de Emisión: ', fmtDate(venta.FECHA_VENTA), 7.5);
  ry += 5;
  lv(rx, ry, 'CUIT: ', fmtCuit(empresa.CUIT), 7.5);
  ry += 5;
  if (empresa.INGRESOS_BRUTOS) {
    lv(rx, ry, 'Ingresos Brutos: ', empresa.INGRESOS_BRUTOS, 7.5);
    ry += 5;
  }
  if (empresa.INICIO_ACTIVIDADES) {
    lv(rx, ry, 'Fecha de Inicio de Actividades: ', empresa.INICIO_ACTIVIDADES, 7);
  }

  // ════════════════════════════════════════════════
  //  RECEPTOR (customer data)
  // ════════════════════════════════════════════════
  const rTop = hTop + hH;
  let dy = rTop + 5;

  const clienteDocLabel = (venta.CLIENTE_TIPO_DOC || 'CUIT') + ': ';
  lv(lx, dy, clienteDocLabel, venta.CLIENTE_NUMERO_DOC || '-', 7.5);
  lv(CX + 3, dy, 'Apellido y Nombre / Razón Social: ', (venta.CLIENTE_NOMBRE || 'Consumidor Final').substring(0, 40), 7);

  dy += 5;
  lv(lx, dy, 'Condición frente al IVA: ', venta.CLIENTE_CONDICION_IVA || 'Consumidor Final', 7.5);
  lv(CX + 3, dy, 'Domicilio: ', (venta.CLIENTE_DOMICILIO || '-').substring(0, 45), 7.5);

  dy += 5;
  lv(lx, dy, 'Condición de venta: ', 'Otra', 7.5);

  dy += 4;
  const rH = dy - rTop;
  doc.setLineWidth(0.3);
  doc.rect(ML, rTop, CW, rH);

  // ════════════════════════════════════════════════
  //  ITEMS GRID
  // ════════════════════════════════════════════════
  const esFacturaA = letra === 'A';
  const gridTop = rTop + rH;

  type Col = { key: string; label: string; x: number; w: number; align: 'left' | 'center' | 'right' };
  const cols: Col[] = [];
  let cx = ML;

  const addCol = (key: string, label: string, w: number, align: Col['align'] = 'center') => {
    cols.push({ key, label, x: cx, w, align });
    cx += w;
  };

  if (esFacturaA) {
    addCol('codigo', 'Código', 18, 'left');
    const usedW = 18 + 16 + 18 + 24 + 14 + 16 + 20 + 16 + 22;
    addCol('producto', 'Producto / Servicio', CW - usedW, 'left');
    addCol('cantidad', 'Cantidad', 16);
    addCol('uMedida', 'U. Medida', 18);
    addCol('precioUnit', 'Precio Unit.', 24, 'right');
    addCol('bonifPct', '% Bonif', 14);
    addCol('bonifImp', 'Imp. Bonif.', 16, 'right');
    addCol('subtotal', 'Subtotal', 20, 'right');
    addCol('ivaP', '% IVA', 16);
    addCol('subtotalIva', 'Subtotal c/IVA', 22, 'right');
  } else {
    addCol('codigo', 'Código', 20, 'left');
    const usedW = 20 + 18 + 22 + 26 + 18 + 22 + 26;
    addCol('producto', 'Producto / Servicio', CW - usedW, 'left');
    addCol('cantidad', 'Cantidad', 18);
    addCol('uMedida', 'U. Medida', 22);
    addCol('precioUnit', 'Precio Unit.', 26, 'right');
    addCol('bonifPct', '% Bonif', 18);
    addCol('bonifImp', 'Imp. Bonif.', 22, 'right');
    addCol('subtotal', 'Subtotal', 26, 'right');
  }

  // Grid header
  const thH = 7;
  doc.setFillColor('#e8e8e8');
  doc.rect(ML, gridTop, CW, thH, 'FD');
  doc.setLineWidth(0.3);
  doc.setDrawColor('#000000');
  for (let i = 1; i < cols.length; i++) {
    doc.line(cols[i]!.x, gridTop, cols[i]!.x, gridTop + thH);
  }
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  const thTextY = gridTop + 4.8;
  for (const col of cols) {
    if (col.align === 'left') doc.text(col.label, col.x + 1.5, thTextY);
    else if (col.align === 'right') doc.text(col.label, col.x + col.w - 1.5, thTextY, { align: 'right' });
    else doc.text(col.label, col.x + col.w / 2, thTextY, { align: 'center' });
  }

  // Grid body
  let y = gridTop + thH;
  const rowH = 6.5;
  const maxBodyY = 222;
  const items = venta.items;

  const drawGridHeader = (atY: number) => {
    doc.setFillColor('#e8e8e8');
    doc.rect(ML, atY, CW, thH, 'FD');
    doc.setLineWidth(0.3);
    for (let i = 1; i < cols.length; i++) {
      doc.line(cols[i]!.x, atY, cols[i]!.x, atY + thH);
    }
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    for (const col of cols) {
      if (col.align === 'left') doc.text(col.label, col.x + 1.5, atY + 4.8);
      else if (col.align === 'right') doc.text(col.label, col.x + col.w - 1.5, atY + 4.8, { align: 'right' });
      else doc.text(col.label, col.x + col.w / 2, atY + 4.8, { align: 'center' });
    }
    doc.setFont('helvetica', 'normal');
  };

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (y + rowH > maxBodyY) {
      doc.setDrawColor('#000000');
      doc.setLineWidth(0.3);
      doc.line(ML, y, ML + CW, y);
      doc.addPage();
      y = 12;
      drawGridHeader(y);
      y += thH;
    }

    if (i % 2 === 1) {
      doc.setFillColor('#f7f7f7');
      doc.rect(ML, y, CW, rowH, 'F');
    }

    doc.setDrawColor('#dddddd');
    doc.setLineWidth(0.1);
    doc.line(ML, y + rowH, ML + CW, y + rowH);

    const textY = y + 4.5;
    doc.setTextColor('#000000');
    doc.setFontSize(6.5);

    const gc = (key: string) => cols.find(c => c.key === key)!;
    const sub = itemSubtotal(item);
    const bonifAmt = itemBonif(item);
    const bonifPctStr = item.DESCUENTO > 0 ? fmtMoney(item.DESCUENTO) : '0,00';

    doc.text(item.PRODUCTO_CODIGO || '', gc('codigo').x + 1.5, textY);
    doc.text((item.PRODUCTO_NOMBRE || '').substring(0, 45), gc('producto').x + 1.5, textY);
    doc.text(fmtMoney(item.CANTIDAD), gc('cantidad').x + gc('cantidad').w / 2, textY, { align: 'center' });
    doc.text(item.UNIDAD_ABREVIACION || 'unidades', gc('uMedida').x + gc('uMedida').w / 2, textY, { align: 'center' });
    doc.text(fmtMoney(item.PRECIO_UNITARIO), gc('precioUnit').x + gc('precioUnit').w - 1.5, textY, { align: 'right' });
    doc.text(bonifPctStr, gc('bonifPct').x + gc('bonifPct').w / 2, textY, { align: 'center' });
    doc.text(fmtMoney(bonifAmt), gc('bonifImp').x + gc('bonifImp').w - 1.5, textY, { align: 'right' });
    doc.text(fmtMoney(sub), gc('subtotal').x + gc('subtotal').w - 1.5, textY, { align: 'right' });

    if (esFacturaA) {
      const ivaPct = item.IVA_ALICUOTA > 0 ? fmtMoney(item.IVA_ALICUOTA * 100) : '0,00';
      doc.text(ivaPct, gc('ivaP').x + gc('ivaP').w / 2, textY, { align: 'center' });
      const subConIva = sub + (item.IVA_MONTO || 0);
      doc.text(fmtMoney(subConIva), gc('subtotalIva').x + gc('subtotalIva').w - 1.5, textY, { align: 'right' });
    }

    y += rowH;
  }

  // Bottom border of items grid
  doc.setDrawColor('#000000');
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML + CW, y);

  // ════════════════════════════════════════════════
  //  TOTALS BOX (right-aligned)
  // ════════════════════════════════════════════════
  const totBoxW = 80;
  const totBoxX = ML + CW - totBoxW;
  let tY = Math.max(y + 2, 225);

  const totLines: { label: string; value: string; bold?: boolean }[] = [];
  if (esFacturaA) {
    totLines.push({ label: 'Importe Neto Gravado: $', value: fmtMoney(venta.NETO_GRAVADO || 0) });
    totLines.push({ label: 'IVA 21%: $', value: fmtMoney(venta.IVA_TOTAL || 0) });
    if ((venta.NETO_EXENTO || 0) > 0) {
      totLines.push({ label: 'Importe Exento: $', value: fmtMoney(venta.NETO_EXENTO || 0) });
    }
    totLines.push({ label: 'Importe Otros Tributos: $', value: fmtMoney(0) });
  } else {
    totLines.push({ label: 'Subtotal: $', value: fmtMoney(venta.SUBTOTAL || venta.TOTAL) });
    totLines.push({ label: 'Importe Otros Tributos: $', value: fmtMoney(0) });
  }
  totLines.push({ label: 'Importe Total: $', value: fmtMoney(venta.TOTAL), bold: true });

  const totRowH = 6.5;
  const totH = totLines.length * totRowH + 2;
  doc.setLineWidth(0.3);
  doc.rect(totBoxX, tY, totBoxW, totH);

  for (let i = 0; i < totLines.length; i++) {
    const line = totLines[i]!;
    const lineY = tY + 5 + i * totRowH;
    if (i > 0) {
      doc.setDrawColor('#cccccc');
      doc.setLineWidth(0.1);
      doc.line(totBoxX, tY + 1 + i * totRowH, totBoxX + totBoxW, tY + 1 + i * totRowH);
    }
    doc.setFontSize(line.bold ? 9 : 7.5);
    doc.setFont('helvetica', 'bold');
    doc.text(line.label, totBoxX + totBoxW - 32, lineY, { align: 'right' });
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
    doc.text(line.value, totBoxX + totBoxW - 2, lineY, { align: 'right' });
  }

  // ════════════════════════════════════════════════
  //  FOOTER — QR, page number, CAE, disclaimer
  // ════════════════════════════════════════════════
  const footerTop = tY + totH + 4;
  doc.setLineWidth(0.3);
  doc.line(ML, footerTop, ML + CW, footerTop);

  // QR Code (bottom-left)
  const qrSize = 28;
  if (qrDataUrl) {
    try { doc.addImage(qrDataUrl, 'PNG', ML + 2, footerTop + 2, qrSize, qrSize); } catch { /* skip */ }
  }

  // Page number (center)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#000000');
  doc.text('Pág. 1/1', CX, footerTop + 8, { align: 'center' });

  // CAE info (right)
  const caeRx = ML + CW - 3;
  doc.setFontSize(8);
  lv(caeRx - doc.getTextWidth('CAE N°: ' + cae), footerTop + 7, 'CAE N°: ', cae, 8);
  const vtoStr = fmtFechaVto(caeVto);
  lv(caeRx - doc.getTextWidth('Fecha de Vto. de CAE: ' + vtoStr), footerTop + 13, 'Fecha de Vto. de CAE: ', vtoStr, 8);

  // "Comprobante Autorizado"
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor('#000000');
  doc.text('Comprobante Autorizado', ML + qrSize + 6, footerTop + 20);

  // Disclaimer
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#555555');
  doc.text(
    'Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación',
    ML + qrSize + 6, footerTop + 25,
  );
}
