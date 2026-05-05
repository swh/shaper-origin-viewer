import type { Ring } from "../parser/types";

/**
 * Cut shape produced by a router bit. Direction (up-spiral / down-spiral /
 * compression) is intentionally absent — it doesn't affect what the cut looks
 * like, only how chips evacuate. Today only `flat` is rendered correctly; the
 * others fall back to a flat-bottomed kerf at the nominal diameter.
 *
 * Undercutting profiles (T-slot, dovetail) are excluded because the heightmap
 * renderer can't represent overhangs.
 */
export type BitProfile = "flat" | "ball" | "v" | "coving" | "fingerpull";

export type Tool = {
  diameterMm: number;
  profile: BitProfile;
  /** Included angle for v-bits, used to compute depth-dependent kerf width. */
  angleDeg?: number;
};

/** Default Shaper Origin tool when none is specified per-cut or per-document. */
export const DEFAULT_TOOL: Tool = { diameterMm: 6, profile: "flat" };

/**
 * 2D footprint of where material is removed from the top surface.
 *
 * Multi-polygon shape: the outer array is the list of polygons; each polygon
 * is a list of rings where ring[0] is the exterior and ring[1..] are holes.
 * This matches the `polygon-clipping` convention.
 */
export type Footprint = Ring[][];

export const EMPTY_FOOTPRINT: Footprint = [];
