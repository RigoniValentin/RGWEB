/**
 * Formato de moneda argentino: punto como separador de miles, coma como decimal.
 * Ejemplos: 1.234,56  /  0,00  /  15.000,00
 */

const arFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatea un número como moneda AR sin símbolo: "1.234,56" */
export function fmtNum(value: number | null | undefined): string {
  return arFormatter.format(value ?? 0);
}

/** Formatea un número con símbolo $: "$ 1.234,56" */
export function fmtMoney(value: number | null | undefined): string {
  return `$ ${fmtNum(value)}`;
}

/** Formatea valor absoluto con $: "$ 1.234,56" (para egresos que vienen negativos) */
export function fmtMoneyAbs(value: number | null | undefined): string {
  return `$ ${fmtNum(Math.abs(value ?? 0))}`;
}

/** Formatea un número con símbolo U$S: "U$S 1.234,56" */
export function fmtUsd(value: number | null | undefined): string {
  return `U$S ${fmtNum(value)}`;
}

/** Normaliza tipos tipo "Fa.A"/"F.A"/"FA" a etiqueta "Fact.A" */
export function fmtComprobanteTipo(tipo: string | null | undefined): string {
  const t = (tipo || '').trim();
  if (!t) return '';
  if (!/^F/i.test(t)) return t;

  const letra = t
    .replace(/^Fa\./i, '')
    .replace(/^F\./i, '')
    .replace(/^F/i, '')
    .trim()
    .toUpperCase();

  return `Fact.${letra || t.toUpperCase()}`;
}

/**
 * Formatter para el componente <Statistic> de Ant Design.
 * Uso: <Statistic formatter={statFormatter} ... />
 */
export function statFormatter(value: string | number | undefined): string {
  return fmtNum(typeof value === 'string' ? parseFloat(value) : (value ?? 0));
}
