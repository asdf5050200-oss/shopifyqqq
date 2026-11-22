/**
 * Integer-scaled fixed-point decimal helpers (4 decimal places for prices/money)
 * Prevents IEEE-754 floating-point drift in margins, PnL, fees, and ledgers.
 */
const SCALE = 10000;

export function toFixedInt(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * SCALE);
}

export function fromFixedInt(scaled: number): number {
  return Math.round(scaled) / SCALE;
}

export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function roundPrice(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

export function addMoney(a: number, b: number): number {
  return roundMoney((toFixedInt(a) + toFixedInt(b)) / SCALE);
}

export function subMoney(a: number, b: number): number {
  return roundMoney((toFixedInt(a) - toFixedInt(b)) / SCALE);
}

export function mulMoney(a: number, b: number): number {
  return roundMoney(a * b);
}
