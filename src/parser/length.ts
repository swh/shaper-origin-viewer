const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  "": 1, // bare number on a shaper attribute → assume mm
};

const LENGTH_RE = /^\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/;

export function parseLengthMm(text: string | null | undefined): number | null {
  if (text == null) return null;
  const match = String(text).match(LENGTH_RE);
  if (!match) throw new Error(`cannot parse length: ${text}`);
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const factor = UNIT_TO_MM[unit];
  if (factor === undefined) throw new Error(`unsupported unit ${unit} in ${text}`);
  return value * factor;
}
