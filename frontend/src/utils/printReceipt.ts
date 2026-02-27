/**
 * 80mm Thermal Receipt Printer — Browser Print API
 *
 * Generates an HTML receipt styled for 80mm (≈302px at 96dpi) paper
 * and prints it via a hidden iframe using window.print().
 */

export interface ReceiptItem {
  nombre: string;
  cantidad: number;
  unidad: string; // 'u', 'Kg', 'lts', etc.
  precioUnitario: number;
  descuento: number;
  subtotal: number;
}

export interface ReceiptData {
  ventaId: number;
  nombreFantasia: string;
  clienteNombre: string;
  usuarioNombre: string;
  fecha: Date;
  items: ReceiptItem[];
  dtoGral: number;
  subtotal: number;
  total: number;
  esCtaCorriente: boolean;
  montoEfectivo?: number;
  montoDigital?: number;
  vuelto?: number;
  metodoPago?: 'efectivo' | 'digital' | 'mixto';
}

function fmtAR(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtQty(cantidad: number, unidad: string): string {
  const u = (unidad || 'u').toLowerCase();
  if (u === 'kg') return `${cantidad.toFixed(3)} Kg`;
  if (u === 'lts' || u === 'lt') return `${cantidad.toFixed(2)} lts`;
  return `${cantidad.toFixed(cantidad % 1 === 0 ? 0 : 2)} u`;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildReceiptHTML(data: ReceiptData): string {
  const itemsHTML = data.items.map(item => {
    const descLabel = item.descuento > 0 ? `  (Desc: ${fmtAR(item.descuento)}%)` : '';
    return `
      <div class="item">
        <div class="item-name">${escapeHTML(item.nombre)}</div>
        <div class="item-detail">
          <span>${fmtQty(item.cantidad, item.unidad)} x $${fmtAR(item.precioUnitario)}${descLabel}</span>
          <span class="item-total">$${fmtAR(item.subtotal)}</span>
        </div>
      </div>
    `;
  }).join('');

  let paymentHTML = '';
  if (!data.esCtaCorriente && data.metodoPago) {
    const parts: string[] = [];
    if (data.metodoPago === 'efectivo' || data.metodoPago === 'mixto') {
      parts.push(`<div class="pay-line"><span>Efectivo:</span><span>$${fmtAR(data.montoEfectivo || 0)}</span></div>`);
    }
    if (data.metodoPago === 'digital' || data.metodoPago === 'mixto') {
      parts.push(`<div class="pay-line"><span>Digital:</span><span>$${fmtAR(data.montoDigital || 0)}</span></div>`);
    }
    if ((data.vuelto || 0) > 0) {
      parts.push(`<div class="pay-line vuelto"><span>Vuelto:</span><span>$${fmtAR(data.vuelto || 0)}</span></div>`);
    }
    if (parts.length > 0) {
      paymentHTML = `<div class="separator"></div>${parts.join('')}`;
    }
  }

  const dtoGralHTML = data.dtoGral > 0
    ? `<div class="pay-line"><span>Subtotal:</span><span>$${fmtAR(data.subtotal)}</span></div>
       <div class="pay-line"><span>Dto. ${fmtAR(data.dtoGral)}%:</span><span>-$${fmtAR(data.subtotal * data.dtoGral / 100)}</span></div>`
    : '';

  const ctaCteHTML = data.esCtaCorriente
    ? `<div class="separator dashed"></div><div class="cta-cte">CUENTA CORRIENTE</div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ticket Venta #${data.ventaId}</title>
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
      color: #000;
      line-height: 1.4;
    }
    .header {
      text-align: center;
      font-size: 16px;
      font-weight: bold;
      padding: 4px 0 2px;
    }
    .separator {
      border-top: 1px solid #000;
      margin: 4px 0;
    }
    .separator.dashed {
      border-top-style: dashed;
    }
    .info {
      font-size: 11px;
    }
    .info-center {
      text-align: center;
      font-size: 13px;
      font-weight: bold;
      padding: 2px 0;
    }
    .section-title {
      text-align: center;
      font-weight: bold;
      font-size: 11px;
      padding: 2px 0;
    }
    .item {
      margin: 3px 0;
    }
    .item-name {
      font-size: 12px;
      font-weight: bold;
      word-wrap: break-word;
    }
    .item-detail {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding-left: 4px;
    }
    .item-total {
      font-weight: bold;
      white-space: nowrap;
    }
    .total-box {
      display: flex;
      justify-content: space-between;
      font-size: 16px;
      font-weight: bold;
      padding: 4px 0;
    }
    .pay-line {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }
    .pay-line.vuelto {
      font-weight: bold;
    }
    .cta-cte {
      text-align: center;
      font-weight: bold;
      font-size: 12px;
      padding: 2px 0;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      padding: 4px 0 2px;
    }
    .footer-small {
      text-align: center;
      font-size: 9px;
      color: #555;
      padding-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="header">${escapeHTML(data.nombreFantasia)}</div>
  <div class="separator"></div>
  <div class="info-center">VENTA #${data.ventaId}</div>
  <div class="info">Cliente: ${escapeHTML(data.clienteNombre)}</div>
  <div class="info">Fecha: ${formatDate(data.fecha)}</div>
  <div class="separator"></div>
  <div class="section-title">DETALLE DE PRODUCTOS</div>
  <div class="separator"></div>
  ${itemsHTML}
  <div class="separator"></div>
  ${dtoGralHTML}
  <div class="total-box">
    <span>TOTAL:</span>
    <span>$${fmtAR(data.total)}</span>
  </div>
  ${paymentHTML}
  ${ctaCteHTML}
  <div class="separator"></div>
  <div class="footer">¡Gracias por su compra!</div>
  <div class="footer-small">Atendido por: ${escapeHTML(data.usuarioNombre)}</div>
  <div class="footer-small">Río Gestión Software</div>
</body>
</html>
  `.trim();
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Opens a print dialog for an 80mm receipt.
 * Uses a hidden iframe to avoid disrupting the current page.
 */
export function printReceipt(data: ReceiptData): void {
  const html = buildReceiptHTML(data);

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

  // Wait for content to render, then print
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      // Clean up after a delay
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }, 300);
  };

  // Fallback if onload doesn't fire
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } catch { /* ignore */ }
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* ignore */ }
    }, 2000);
  }, 1000);
}
