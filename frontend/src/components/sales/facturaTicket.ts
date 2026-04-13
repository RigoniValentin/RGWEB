import type { FacturaData, FacturaDataItem } from '../../services/sales.api';
import dayjs from 'dayjs';

/**
 * Prints an 80mm fiscal ticket for a factura electrónica.
 * Uses a hidden iframe with HTML styled for thermal printers.
 */
export function printFacturaTicket(data: FacturaData): void {
  const html = buildTicketHTML(data);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-10000px';
  iframe.style.left = '-10000px';
  iframe.style.width = '80mm';
  iframe.style.height = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch { /* ignore */ }
      }, 2000);
    }, 300);
  };
}

// ── Helpers ─────────────────────────────────────

function fmtAR(v: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function fmtQty(cantidad: number, unidad: string): string {
  const u = (unidad || 'u').toLowerCase();
  if (u === 'kg') return `${cantidad.toFixed(3)} Kg`;
  if (u === 'lts' || u === 'lt') return `${cantidad.toFixed(2)} lts`;
  return `${cantidad.toFixed(cantidad % 1 === 0 ? 0 : 2)} u`;
}

function fmtDate(d: string): string {
  return dayjs(d).format('DD/MM/YYYY HH:mm');
}

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
  if (t.includes('NC') || t.includes('CRÉDITO')) return 'NOTA DE CRÉDITO';
  if (t.includes('ND') || t.includes('DÉBITO')) return 'NOTA DE DÉBITO';
  return 'FACTURA';
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemSubtotal(item: FacturaDataItem): number {
  const unitPrice = item.PRECIO_UNITARIO_DTO != null
    ? item.PRECIO_UNITARIO_DTO
    : (item.DESCUENTO > 0
      ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
      : item.PRECIO_UNITARIO);
  return unitPrice * item.CANTIDAD;
}

function buildTicketHTML(data: FacturaData): string {
  const { venta, feResp, empresa } = data;
  const letra = getLetra(venta.TIPO_COMPROBANTE);
  const titulo = getTitulo(venta.TIPO_COMPROBANTE);
  const ptoVta = (venta.PUNTO_VENTA || '00001').padStart(5, '0');
  const nroComp = (venta.NUMERO_FISCAL || '00000001').padStart(8, '0');
  const cae = venta.CAE || feResp?.CAE || '';
  const caeVto = feResp?.VENCIMIENTO_CAE || '';

  const itemsHTML = venta.items.map(item => {
    const sub = itemSubtotal(item);
    const descLabel = item.DESCUENTO > 0 ? ` (-${fmtAR(item.DESCUENTO)}%)` : '';
    return `
      <div class="item">
        <div class="item-name">${escapeHTML(item.PRODUCTO_NOMBRE || '')}</div>
        <div class="item-detail">
          <span>${fmtQty(item.CANTIDAD, item.UNIDAD_ABREVIACION)} x $${fmtAR(item.PRECIO_UNITARIO)}${descLabel}</span>
          <span class="item-total">$${fmtAR(sub)}</span>
        </div>
      </div>
    `;
  }).join('');

  const esFacturaA = letra === 'A';
  let ivaHTML = '';
  if (esFacturaA) {
    ivaHTML = `
      <div class="pay-line"><span>Neto Gravado:</span><span>$${fmtAR(venta.NETO_GRAVADO || 0)}</span></div>
      <div class="pay-line"><span>IVA:</span><span>$${fmtAR(venta.IVA_TOTAL || 0)}</span></div>
      ${(venta.NETO_EXENTO || 0) > 0 ? `<div class="pay-line"><span>Exento:</span><span>$${fmtAR(venta.NETO_EXENTO || 0)}</span></div>` : ''}
    `;
  }

  let dtoHTML = '';
  if (venta.DTO_GRAL && venta.DTO_GRAL > 0 && venta.SUBTOTAL) {
    dtoHTML = `
      <div class="pay-line"><span>Subtotal:</span><span>$${fmtAR(venta.SUBTOTAL)}</span></div>
      <div class="pay-line"><span>Dto. ${fmtAR(venta.DTO_GRAL)}%:</span><span>-$${fmtAR(venta.SUBTOTAL * venta.DTO_GRAL / 100)}</span></div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${titulo} ${letra} ${ptoVta}-${nroComp}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 2mm 3mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      width: 72mm;
      padding: 2mm 3mm;
      color: #000;
      line-height: 1.4;
    }
    .header { text-align: center; font-size: 14px; font-weight: bold; padding: 4px 0 2px; }
    .empresa-info { text-align: center; font-size: 10px; }
    .separator { border-top: 1px solid #000; margin: 4px 0; }
    .separator.dashed { border-top-style: dashed; }
    .tipo-box {
      text-align: center; font-size: 18px; font-weight: bold;
      border: 2px solid #000; width: 28px; height: 28px;
      line-height: 28px; margin: 4px auto;
    }
    .titulo { text-align: center; font-size: 14px; font-weight: bold; }
    .comp-nro { text-align: center; font-size: 13px; font-weight: bold; padding: 2px 0; }
    .info { font-size: 10px; }
    .info b { font-weight: bold; }
    .section-title { text-align: center; font-weight: bold; font-size: 11px; padding: 2px 0; }
    .item { margin: 3px 0; }
    .item-name { font-size: 11px; font-weight: bold; word-wrap: break-word; }
    .item-detail {
      display: flex; justify-content: space-between;
      font-size: 10px; padding-left: 4px;
    }
    .item-total { font-weight: bold; white-space: nowrap; }
    .total-box {
      display: flex; justify-content: space-between;
      font-size: 16px; font-weight: bold; padding: 4px 0;
    }
    .pay-line { display: flex; justify-content: space-between; font-size: 10px; }
    .cae-section { font-size: 9px; text-align: center; padding: 2px 0; }
    .cae-section b { font-weight: bold; }
    .footer { text-align: center; font-size: 9px; color: #555; padding: 2px 0; }
  </style>
</head>
<body>
  <div class="header">${escapeHTML(empresa.NOMBRE_FANTASIA || empresa.RAZON_SOCIAL)}</div>
  ${empresa.NOMBRE_FANTASIA && empresa.RAZON_SOCIAL && empresa.NOMBRE_FANTASIA !== empresa.RAZON_SOCIAL ? `<div class="empresa-info">${escapeHTML(empresa.RAZON_SOCIAL)}</div>` : ''}
  <div class="empresa-info">CUIT: ${fmtCuit(empresa.CUIT)}</div>
  <div class="empresa-info">${escapeHTML(empresa.CONDICION_IVA || '')}</div>
  <div class="empresa-info">${escapeHTML(empresa.DOMICILIO || '')}${empresa.LOCALIDAD ? ' - ' + escapeHTML(empresa.LOCALIDAD) : ''}</div>
  <div class="separator"></div>
  <div class="tipo-box">${letra}</div>
  <div class="titulo">${titulo}</div>
  <div class="comp-nro">${ptoVta}-${nroComp}</div>
  <div class="info">Fecha: ${fmtDate(venta.FECHA_VENTA)}</div>
  <div class="separator"></div>
  <div class="info"><b>Cliente:</b> ${escapeHTML(venta.CLIENTE_NOMBRE || 'Consumidor Final')}</div>
  <div class="info"><b>${escapeHTML(venta.CLIENTE_TIPO_DOC || 'DNI')}:</b> ${escapeHTML(venta.CLIENTE_NUMERO_DOC || '-')}</div>
  <div class="info"><b>Cond. IVA:</b> ${escapeHTML(venta.CLIENTE_CONDICION_IVA || 'Consumidor Final')}</div>
  <div class="separator"></div>
  <div class="section-title">DETALLE</div>
  <div class="separator dashed"></div>
  ${itemsHTML}
  <div class="separator"></div>
  ${dtoHTML}
  ${ivaHTML}
  <div class="total-box">
    <span>TOTAL:</span>
    <span>$${fmtAR(venta.TOTAL)}</span>
  </div>
  <div class="separator"></div>
  <div class="cae-section">
    <b>CAE Nº:</b> ${cae}<br/>
    <b>Vto. CAE:</b> ${fmtFechaVto(caeVto)}
  </div>
  <div class="separator dashed"></div>
  <div class="footer">Comprobante electrónico - ARCA</div>
  <div class="footer">Río Gestión Software</div>
</body>
</html>
  `.trim();
}
