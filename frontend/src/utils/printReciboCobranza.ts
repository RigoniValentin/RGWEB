/**
 * Recibo de Cobranza — Browser Print API
 *
 * Generates an A4 HTML recibo (receipt) for a Cobranza (collection payment)
 * and prints it via a hidden iframe using window.print().
 *
 * Follows the same pattern as printCajaDetail.ts
 */

import type { ReciboData } from '../services/cobranzas.api';
import { settingsApi } from '../services/settings.api';

function fmtAR(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtMoney(value: number): string {
  return `$ ${fmtAR(value)}`;
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReciboHTML(data: ReciboData, logoDataUrl?: string | null): string {
  const empresa = data.empresa;
  const empresaNombre = empresa.RAZON_SOCIAL || empresa.NOMBRE_FANTASIA || '';
  const empresaDomicilio = empresa.DOMICILIO_FISCAL || '';
  const empresaCuit = empresa.CUIT || '';

  // Build header info line
  const headerLine = empresaDomicilio;

  // Payment methods rows
  const metodoRows = data.metodos_pago.map(mp => {
    const isEfectivo = mp.CATEGORIA === 'EFECTIVO';
    return `
      <tr>
        <td style="padding: 8px 16px;">
          <span class="metodo-badge ${isEfectivo ? 'badge-efectivo' : 'badge-digital'}">${escapeHTML(mp.CATEGORIA)}</span>
          ${escapeHTML(mp.METODO_NOMBRE)}
        </td>
        <td class="cell-right" style="padding: 8px 16px; font-weight: 600;">${fmtMoney(mp.MONTO)}</td>
      </tr>`;
  }).join('');

  // Fallback if no metodos_pago stored — show category breakdown
  const fallbackRows = !data.metodos_pago.length ? `
    ${data.EFECTIVO > 0 ? `<tr><td style="padding: 8px 16px;"><span class="metodo-badge badge-efectivo">EFECTIVO</span> Efectivo</td><td class="cell-right" style="padding: 8px 16px; font-weight: 600;">${fmtMoney(data.EFECTIVO)}</td></tr>` : ''}
    ${data.DIGITAL > 0 ? `<tr><td style="padding: 8px 16px;"><span class="metodo-badge badge-digital">DIGITAL</span> Digital</td><td class="cell-right" style="padding: 8px 16px; font-weight: 600;">${fmtMoney(data.DIGITAL)}</td></tr>` : ''}
    ${data.CHEQUES > 0 ? `<tr><td style="padding: 8px 16px;"><span class="metodo-badge badge-efectivo">CHEQUE</span> Cheques</td><td class="cell-right" style="padding: 8px 16px; font-weight: 600;">${fmtMoney(data.CHEQUES)}</td></tr>` : ''}
  ` : '';

  // Parse concepto (strip "CO #ID - " prefix)
  let concepto = data.CONCEPTO || '';
  const match = concepto.match(/^CO #\d+\s*-?\s*(.*)/);
  if (match) concepto = match[1] || '';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Recibo ${String(data.PAGO_ID).padStart(6, '0')} - ${data.CLIENTE_NOMBRE} - ${formatDateShort(data.FECHA)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 20mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      color: #222;
      line-height: 1.5;
      padding: 30px 36px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Header ─── */
    .recibo-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .empresa-left {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      flex: 1;
    }
    .empresa-logo {
      max-width: 70px;
      max-height: 70px;
      object-fit: contain;
      border-radius: 4px;
    }
    .empresa-info {
      flex: 1;
    }
    .empresa-info h1 {
      font-size: 22px;
      font-weight: 800;
      color: #111;
      margin: 0 0 2px 0;
      letter-spacing: -0.5px;
    }
    .empresa-info .header-detail {
      font-size: 11px;
      color: #555;
    }
    .recibo-numero-box {
      text-align: right;
      min-width: 200px;
    }
    .recibo-label {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 1px;
      border-bottom: 3px solid #222;
      padding-bottom: 4px;
      margin-bottom: 6px;
      display: inline-block;
    }
    .recibo-numero {
      font-size: 24px;
      font-weight: 800;
      color: #111;
    }
    .recibo-fecha {
      font-size: 12px;
      color: #555;
      margin-top: 4px;
    }

    /* ── Separator ─── */
    .separator {
      border: none;
      border-top: 2px solid #333;
      margin: 16px 0;
    }
    .separator-light {
      border: none;
      border-top: 1px solid #ddd;
      margin: 12px 0;
    }

    /* ── Client box ─── */
    .client-box {
      border: 1.5px solid #333;
      border-radius: 6px;
      padding: 14px 20px;
      margin-bottom: 20px;
    }
    .client-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 30px;
    }
    .client-grid .field {
      display: flex;
      gap: 8px;
    }
    .client-grid .field .label {
      font-weight: 600;
      color: #555;
      white-space: nowrap;
      min-width: 75px;
    }
    .client-grid .field .value {
      color: #111;
      font-weight: 600;
    }

    /* ── Payment table ─── */
    .payment-section {
      margin-bottom: 20px;
    }
    .payment-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.5px solid #333;
      border-radius: 6px;
      overflow: hidden;
    }
    .payment-table thead th {
      background: #E8F0FE;
      color: #222;
      font-weight: 700;
      font-size: 12px;
      padding: 10px 16px;
      text-decoration: underline;
      border-bottom: 1.5px solid #333;
    }
    .payment-table tbody td {
      padding: 8px 16px;
      border-bottom: 1px solid #eee;
      font-size: 12px;
    }
    .payment-table tbody tr:last-child td {
      border-bottom: none;
    }
    .cell-right { text-align: right; }
    .cell-center { text-align: center; }

    /* ── Total row ─── */
    .total-row {
      background: #E8F0FE;
      border-top: 1.5px solid #333;
    }
    .total-row td {
      padding: 10px 16px !important;
      font-size: 14px !important;
      font-weight: 800 !important;
    }

    /* ── Badges ─── */
    .metodo-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .badge-efectivo {
      background: #f6ffed;
      color: #389e0d;
      border: 1px solid #b7eb8f;
    }
    .badge-digital {
      background: #e6f7ff;
      color: #096dd9;
      border: 1px solid #91d5ff;
    }

    /* ── Nota + Saldo ─── */
    .nota-section {
      margin-top: 16px;
      font-size: 12px;
    }
    .nota-section .nota-label {
      font-weight: 800;
    }
    .saldo-section {
      margin-top: 12px;
      font-size: 13px;
    }
    .saldo-section .saldo-label {
      font-weight: 700;
    }
    .saldo-section .saldo-value {
      font-weight: 800;
      font-size: 15px;
      margin-left: 16px;
    }

    /* ── Footer ─── */
    .recibo-footer {
      margin-top: 60px;
      display: flex;
      justify-content: flex-end;
    }
    .firma-box {
      text-align: center;
      min-width: 220px;
    }
    .firma-line {
      border-top: 1.5px solid #333;
      margin-bottom: 6px;
    }
    .firma-text {
      font-size: 12px;
      font-weight: 700;
    }

    .print-meta {
      margin-top: 40px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #999;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="recibo-header">
    <div class="empresa-left">
      ${logoDataUrl ? `<img class="empresa-logo" src="${logoDataUrl}" alt="Logo" />` : ''}
      <div class="empresa-info">
        <h1>${escapeHTML(empresaNombre)}</h1>
        ${headerLine ? `<div class="header-detail">${escapeHTML(headerLine)}</div>` : ''}
        ${empresaCuit ? `<div class="header-detail">CUIT: ${escapeHTML(empresaCuit)}</div>` : ''}
      </div>
    </div>
    <div class="recibo-numero-box">
      <div class="recibo-label">RECIBO Nº</div>
      <div class="recibo-numero">${String(data.PAGO_ID).padStart(6, '0')}</div>
      <div class="recibo-fecha">Fecha: ${formatDateShort(data.FECHA)}</div>
    </div>
  </div>

  <hr class="separator" />

  <!-- Client -->
  <div class="client-box">
    <div class="client-grid">
      <div class="field">
        <span class="label">Cliente:</span>
        <span class="value">${escapeHTML(data.CLIENTE_NOMBRE)}</span>
      </div>
      <div class="field">
        <span class="label">Código:</span>
        <span class="value">${escapeHTML(data.CLIENTE_CODIGO || '-')}</span>
      </div>
      ${data.CLIENTE_DOMICILIO ? `
      <div class="field">
        <span class="label">Dirección:</span>
        <span class="value">${escapeHTML(data.CLIENTE_DOMICILIO)}</span>
      </div>` : ''}
      ${data.CLIENTE_LOCALIDAD ? `
      <div class="field">
        <span class="label">Localidad:</span>
        <span class="value">${escapeHTML(data.CLIENTE_LOCALIDAD)}</span>
      </div>` : ''}
      ${data.CLIENTE_DOCUMENTO ? `
      <div class="field">
        <span class="label">CUIT/DNI:</span>
        <span class="value">${escapeHTML(data.CLIENTE_DOCUMENTO)}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Payment methods table -->
  <div class="payment-section">
    <table class="payment-table">
      <thead>
        <tr>
          <th style="text-align: left;">Forma de pago</th>
          <th class="cell-right">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${metodoRows || fallbackRows}
        <tr class="total-row">
          <td class="cell-right">Total Gral.</td>
          <td class="cell-right">${fmtMoney(data.TOTAL)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Nota (concepto) -->
  ${concepto ? `
  <div class="nota-section">
    <span class="nota-label">Nota:</span> ${escapeHTML(concepto)}
  </div>` : ''}

  <!-- Saldo a cancelar -->
  <div class="saldo-section">
    <span class="saldo-label">Saldo a Cancelar:</span>
    <span class="saldo-value">${fmtMoney(data.SALDO_ACTUAL)}</span>
  </div>

  <!-- Firma -->
  <div class="recibo-footer">
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-text">Recibí conforme</div>
    </div>
  </div>

  <!-- Print meta -->
  <div class="print-meta">
    <span>Impreso el ${new Date().toLocaleString('es-AR')} | Atendido por: ${escapeHTML(data.USUARIO)}</span>
    <span>Río Gestión Software</span>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Fetches recibo data and opens a print dialog for the receipt.
 * Uses a hidden iframe to avoid disrupting the current page.
 */
export async function printReciboCobranza(data: ReciboData): Promise<void> {
  // Fetch logo in parallel (non-blocking — prints without logo if unavailable)
  const logoDataUrl = await settingsApi.getLogoDataUrl().catch(() => null);
  const html = buildReciboHTML(data, logoDataUrl);

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
