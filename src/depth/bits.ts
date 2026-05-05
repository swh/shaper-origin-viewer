import type { BitProfile, Tool } from "./types";

export type BitGroup = "metric" | "imperial";

export type Bit = {
  /** Stable id used by the UI store. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Cut shape. Only `flat` affects rendering today; the rest fall back to a flat-bottomed kerf at the nominal diameter (clearly an approximation, flagged in the UI). */
  profile: BitProfile;
  /** Nominal cutting diameter at the widest point. */
  diameterMm: number;
  /** Included angle for v-bits, where defined. */
  angleDeg?: number;
  group: BitGroup;
};

const inch = (n: number) => n * 25.4;

/**
 * Catalogue of router bits Shaper sells. Direction (upcut / downcut /
 * compression) and cutting-edge length are intentionally omitted — they don't
 * change the rendered cut shape, only the diameter and profile do.
 *
 * Undercutting bits (T-slot, dovetail) are excluded: the heightmap renderer
 * is 2.5D and can't represent overhangs where material below is wider than
 * the slot mouth.
 */
export const BITS: readonly Bit[] = [
  // ---------- Metric ----------
  {
    id: "m-flat-3",
    label: "3 mm Flat (up-spiral)",
    profile: "flat",
    diameterMm: 3,
    group: "metric",
  },
  {
    id: "m-flat-4",
    label: "4 mm Flat (up-spiral)",
    profile: "flat",
    diameterMm: 4,
    group: "metric",
  },
  { id: "m-oflute-5", label: "5 mm O-flute", profile: "flat", diameterMm: 5, group: "metric" },
  {
    id: "m-flat-6-21",
    label: "6 mm Flat × 21 mm (up-spiral)",
    profile: "flat",
    diameterMm: 6,
    group: "metric",
  },
  {
    id: "m-flat-6-30",
    label: "6 mm Flat × 30 mm (up-spiral)",
    profile: "flat",
    diameterMm: 6,
    group: "metric",
  },
  {
    id: "m-flat-8",
    label: "8 mm Flat (up-spiral)",
    profile: "flat",
    diameterMm: 8,
    group: "metric",
  },
  { id: "m-rough-8", label: "8 mm Roughing", profile: "flat", diameterMm: 8, group: "metric" },
  {
    id: "m-clear-16",
    label: "16 mm Clearing (3-flute pocketing)",
    profile: "flat",
    diameterMm: 16,
    group: "metric",
  },
  {
    id: "m-engrave-7-60",
    label: "60° × 7 mm Engraving",
    profile: "v",
    diameterMm: 7,
    angleDeg: 60,
    group: "metric",
  },
  {
    id: "m-cove-19",
    label: "19.4 mm Coving",
    profile: "coving",
    diameterMm: 19.4,
    group: "metric",
  },
  {
    id: "m-fingerpull-22",
    label: "22 mm Fingerpull",
    profile: "fingerpull",
    diameterMm: 22,
    group: "metric",
  },

  // ---------- Imperial ----------
  {
    id: "i-flat-quarter-1",
    label: '1/4" Flat × 1" (up-spiral)',
    profile: "flat",
    diameterMm: inch(0.25),
    group: "imperial",
  },
  {
    id: "i-flat-quarter-3-4",
    label: '1/4" Flat × 3/4" (up-spiral)',
    profile: "flat",
    diameterMm: inch(0.25),
    group: "imperial",
  },
  {
    id: "i-oflute-quarter",
    label: '1/4" O-flute × 1½"',
    profile: "flat",
    diameterMm: inch(0.25),
    group: "imperial",
  },
  {
    id: "i-ball-quarter",
    label: '1/4" Ball Nose × 3/4"',
    profile: "ball",
    diameterMm: inch(0.25),
    group: "imperial",
  },
  {
    id: "i-engrave-quarter-60",
    label: '1/4" 60° Engraving (Origin stock bit)',
    profile: "v",
    diameterMm: inch(0.25),
    angleDeg: 60,
    group: "imperial",
  },
  {
    id: "i-flat-eighth",
    label: '1/8" Flat × 1/2" (up-spiral)',
    profile: "flat",
    diameterMm: inch(0.125),
    group: "imperial",
  },
  {
    id: "i-oflute-eighth-short",
    label: '1/8" O-flute × 1/4"',
    profile: "flat",
    diameterMm: inch(0.125),
    group: "imperial",
  },
  {
    id: "i-oflute-eighth-long",
    label: '1/8" O-flute × 1/2"',
    profile: "flat",
    diameterMm: inch(0.125),
    group: "imperial",
  },
  {
    id: "i-engrave-eighth-90",
    label: '1/8" 90° Engraving',
    profile: "v",
    diameterMm: inch(0.125),
    angleDeg: 90,
    group: "imperial",
  },
  {
    id: "i-ball-tapered-11",
    label: "11° Tapered Ball Nose",
    profile: "ball",
    diameterMm: inch(0.25),
    angleDeg: 11,
    group: "imperial",
  },
];

export const CUSTOM_BIT_ID = "custom" as const;

/** Default selection: 6 mm × 21 mm flat up-spiral (matches DEFAULT_TOOL). */
export const DEFAULT_BIT_ID = "m-flat-6-21";

const BIT_BY_ID: Map<string, Bit> = new Map(BITS.map((b) => [b.id, b]));

export function bitById(id: string): Bit | undefined {
  return BIT_BY_ID.get(id);
}

/** Reduce a Bit to the params the depth pipeline cares about. */
export function bitToTool(bit: Bit): Tool {
  return {
    diameterMm: bit.diameterMm,
    profile: bit.profile,
    ...(bit.angleDeg !== undefined ? { angleDeg: bit.angleDeg } : {}),
  };
}
