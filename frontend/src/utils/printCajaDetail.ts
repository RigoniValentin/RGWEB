/**
 * A4 Caja Detail Print — Browser Print API
 *
 * Generates an HTML page styled for A4 paper with the full caja detail
 * (header info, totals summary, and movements table) and prints it
 * via a hidden iframe using window.print().
 */

export interface PrintCajaItem {
  FECHA: string;
  ORIGEN_TIPO: string;
  DESCRIPCION: string | null;
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
}

export interface PrintCajaData {
  cajaId: number;
  estado: string;
  usuarioNombre: string;
  puntoVentaNombre: string;
  fechaApertura: string;
  fechaCierre: string | null;
  montoApertura: number;
  montoCierre: number | null;
  observaciones: string | null;
  totales: {
    efectivo: number;
    digital: number;
    ingresos: number;
    egresos: number;
  };
  items: PrintCajaItem[];
  nombreFantasia?: string;
}

function fmtAR(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtMoney(value: number): string {
  return `$ ${fmtAR(value)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TIPO_LABEL: Record<string, string> = {
  VENTA: 'Venta',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
  FONDO_CAMBIO: 'Fondo Cambio',
  ORDEN_PAGO: 'Orden Pago',
  COMPRA: 'Compra',
};

function buildCajaDetailHTML(data: PrintCajaData): string {
  const itemsHTML = data.items
    .map((item, i) => {
      const isEgreso = item.ORIGEN_TIPO === 'EGRESO' || item.ORIGEN_TIPO === 'ORDEN_PAGO' || item.ORIGEN_TIPO === 'COMPRA';
      const rowClass = i % 2 === 0 ? 'row-even' : 'row-odd';
      return `
      <tr class="${rowClass}">
        <td class="cell-center">${formatDate(item.FECHA)}</td>
        <td class="cell-center"><span class="tag tag-${item.ORIGEN_TIPO.toLowerCase()}">${escapeHTML(TIPO_LABEL[item.ORIGEN_TIPO] || item.ORIGEN_TIPO)}</span></td>
        <td>${escapeHTML(item.DESCRIPCION || '-')}</td>
        <td class="cell-right ${isEgreso ? 'text-danger' : ''}">${fmtMoney(item.MONTO_EFECTIVO)}</td>
        <td class="cell-right">${fmtMoney(item.MONTO_DIGITAL)}</td>
      </tr>`;
    })
    .join('');

  const title = data.nombreFantasia
    ? escapeHTML(data.nombreFantasia)
    : 'Detalle de Caja';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Caja #${data.cajaId} — Detalle</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 12mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      color: #222;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Header ─── */
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #333;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .print-header h1 {
      font-size: 20px;
      font-weight: 700;
      color: #111;
      margin: 0;
    }
    .print-header .subtitle {
      font-size: 13px;
      color: #555;
      margin-top: 2px;
    }
    .print-header .caja-badge {
      display: inline-block;
      background: ${data.estado === 'ACTIVA' ? '#52c41a' : '#888'};
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    /* ── Info grid ─── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 24px;
      margin-bottom: 16px;
      font-size: 11px;
    }
    .info-grid .label {
      font-weight: 600;
      color: #555;
      display: inline;
    }
    .info-grid .value {
      display: inline;
      color: #111;
    }

    /* ── Totals ─── */
    .totals-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .total-box {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 10px 12px;
      text-align: center;
    }
    .total-box .total-label {
      font-size: 10px;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .total-box .total-value {
      font-size: 16px;
      font-weight: 700;
      margin-top: 2px;
    }
    .total-box .total-value.green { color: #389e0d; }
    .total-box .total-value.red { color: #cf1322; }

    /* ── Table ─── */
    .section-title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead th {
      background: #333;
      color: #fff;
      padding: 6px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
    }
    thead th.cell-center { text-align: center; }
    thead th.cell-right { text-align: right; }
    tbody td {
      padding: 5px 8px;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }
    .cell-center { text-align: center; }
    .cell-right { text-align: right; }
    .text-danger { color: #cf1322; }
    .row-even { background: #fff; }
    .row-odd { background: #fafafa; }

    /* ── Tags ─── */
    .tag {
      display: inline-block;
      font-size: 9px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .tag-venta { background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; }
    .tag-ingreso { background: #e6f7ff; color: #096dd9; border: 1px solid #91d5ff; }
    .tag-egreso { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; }
    .tag-fondo_cambio { background: #fff7e6; color: #d46b08; border: 1px solid #ffd591; }
    .tag-orden_pago { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; }
    .tag-compra { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; }

    /* ── Footer ─── */
    .print-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #999;
    }

    /* ── Table totals row ─── */
    .table-totals td {
      border-top: 2px solid #333;
      font-weight: 700;
      font-size: 11px;
      padding: 6px 8px;
      background: #f5f5f5;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="print-header">
    <div>
      <h1>${title}</h1>
      <div class="subtitle">Detalle de Caja #${data.cajaId}</div>
    </div>
    <span class="caja-badge">${escapeHTML(data.estado)}</span>
  </div>

  <!-- Info -->
  <div class="info-grid">
    <div><span class="label">Usuario: </span><span class="value">${escapeHTML(data.usuarioNombre)}</span></div>
    <div><span class="label">Punto de Venta: </span><span class="value">${escapeHTML(data.puntoVentaNombre || '-')}</span></div>
    <div><span class="label">Apertura: </span><span class="value">${formatDate(data.fechaApertura)}</span></div>
    <div><span class="label">Cierre: </span><span class="value">${data.fechaCierre ? formatDate(data.fechaCierre) : '-'}</span></div>
    <div><span class="label">Monto Apertura: </span><span class="value">${fmtMoney(data.montoApertura)}</span></div>
    ${data.montoCierre != null ? `<div><span class="label">Monto Cierre: </span><span class="value">${fmtMoney(data.montoCierre)}</span></div>` : ''}
    ${data.observaciones ? `<div style="grid-column: span 2;"><span class="label">Observaciones: </span><span class="value">${escapeHTML(data.observaciones)}</span></div>` : ''}
  </div>

  <!-- Totals -->
  <div class="totals-row">
    <div class="total-box">
      <div class="total-label">Ingresos</div>
      <div class="total-value green">${fmtMoney(data.totales.ingresos)}</div>
    </div>
    <div class="total-box">
      <div class="total-label">Egresos</div>
      <div class="total-value red">${fmtMoney(data.totales.egresos)}</div>
    </div>
    <div class="total-box">
      <div class="total-label">Efectivo</div>
      <div class="total-value">${fmtMoney(data.totales.efectivo)}</div>
    </div>
    <div class="total-box">
      <div class="total-label">Digital</div>
      <div class="total-value">${fmtMoney(data.totales.digital)}</div>
    </div>
  </div>

  <!-- Movements table -->
  ${data.items.length > 0 ? `
  <div class="section-title">Movimientos (${data.items.length})</div>
  <table>
    <thead>
      <tr>
        <th class="cell-center" style="width:130px">Fecha</th>
        <th class="cell-center" style="width:100px">Tipo</th>
        <th>Descripción</th>
        <th class="cell-right" style="width:110px">Efectivo</th>
        <th class="cell-right" style="width:110px">Digital</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHTML}
      <tr class="table-totals">
        <td colspan="3" class="cell-right">TOTALES</td>
        <td class="cell-right">${fmtMoney(data.items.reduce((s, i) => s + i.MONTO_EFECTIVO, 0))}</td>
        <td class="cell-right">${fmtMoney(data.items.reduce((s, i) => s + i.MONTO_DIGITAL, 0))}</td>
      </tr>
    </tbody>
  </table>
  ` : '<p style="color:#999;text-align:center;margin:20px 0;">Sin movimientos registrados.</p>'}

  <!-- Footer -->
  <div class="print-footer">
    <span>Impreso el ${new Date().toLocaleString('es-AR')}</span>
    <span>Río Gestión Software</span>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Opens a print dialog for an A4 caja detail.
 * Uses a hidden iframe to avoid disrupting the current page.
 */
export function printCajaDetail(data: PrintCajaData): void {
  const html = buildCajaDetailHTML(data);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-10000px';
  iframe.style.left = '-10000px';
  iframe.style.width = '210mm';
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
