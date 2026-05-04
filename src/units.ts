import type { Units } from "./store";

export const MM_PER_IN = 25.4;

/** Convert millimetres to whatever unit the user is currently looking at. */
export function toUserUnits(mm: number, units: Units): number {
  return units === "in" ? mm / MM_PER_IN : mm;
}

/** Convert a user-units value back to millimetres for storage. */
export function fromUserUnits(val: number, units: Units): number {
  return units === "in" ? val * MM_PER_IN : val;
}

/** Sensible default decimals for a length input in the given units. */
export function defaultDecimals(units: Units): number {
  return units === "in" ? 3 : 1;
}

/** Numeric step for a length input. */
export function defaultStep(units: Units): number {
  return units === "in" ? 0.01 : 0.1;
}

/** Format a number with at most `decimals` digits, trimming trailing zeros. */
export function trimTrailingZeros(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Render an mm length in the user's units, e.g. `6.0 mm` or `0.250 in`. */
export function formatLength(mm: number, units: Units, decimals?: number): string {
  const v = toUserUnits(mm, units);
  return `${trimTrailingZeros(v, decimals ?? defaultDecimals(units))} ${units}`;
}
