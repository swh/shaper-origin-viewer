import type { CutType } from "./types";

type ColorKind = "black" | "white" | "grey" | "red" | "blue";

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  blue: [0, 0, 255],
  grey: [128, 128, 128],
  gray: [128, 128, 128],
};

function parseColor(c: string): [number, number, number] | null {
  const trimmed = c.trim();
  const hex = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split("")
        .map((ch) => ch + ch)
        .join("");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return NAMED[trimmed.toLowerCase()] ?? null;
}

function colorKind(color: string | null): ColorKind | null {
  if (!color || color === "none") return null;
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  if (r >= 128 && g < 96 && b < 96) return "red";
  if (b >= 128 && r < 96 && g < 96) return "blue";
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread <= 24) {
    const avg = (r + g + b) / 3;
    if (avg < 32) return "black";
    if (avg > 224) return "white";
    return "grey";
  }
  return null;
}

export function classifyByColor(
  fill: string | null,
  stroke: string | null,
  fillOpacity: number,
): CutType | null {
  const f = colorKind(fill);
  const s = colorKind(stroke);
  if (f === "red") return "anchor";
  if (f === "blue") return "guide";
  if (f === "black" && (s === "black" || s === null)) return "outside";
  if (f === "white" && s === "black") return "inside";
  if (f === "grey" && (s === "white" || s === null)) return "pocket";
  if ((f === "white" && s === "grey") || (fillOpacity === 0 && s === "grey")) return "online";

  // Fallback for plain stroke-only line drawings (no fill, dark stroke) —
  // common in Inkscape exports that don't follow Shaper's strict colour
  // conventions. Treat as `online` so the bit follows the path. Excludes
  // blue/red strokes since those have dedicated meanings (guide / anchor).
  const noFill = f === null || fillOpacity === 0;
  if (noFill && (s === "black" || s === "grey")) return "online";

  return null;
}
