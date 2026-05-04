import { ExtrudeGeometry, Shape, Path as ThreePath } from "three";
import { type Footprint, type Tool, cutFootprint, difference, union } from "../depth";
import type { Cut, Doc } from "../parser";

export type { Cut } from "../parser";

const THROUGH_OVERSHOOT_MM = 0.5; // Extra extrusion past the bottom for clean CSG

export type CutVolume = {
  geometry: ExtrudeGeometry;
  topY: number;
  bottomY: number;
  isThrough: boolean;
};

export type BoardParams = {
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
};

export type BuildCutVolumesOptions = {
  /**
   * When true (default), shallower cut footprints are trimmed by the union of
   * all deeper cuts so the resulting volumes don't overlap. Useful for the
   * debug renderer; not always desirable for CSG, where overlapping volumes
   * are fine (subtraction handles them cleanly) and the trimming step turns
   * shallow cuts into polygon-with-holes shapes that confuse the CSG engine.
   */
  preprocessOverlaps?: boolean;
};

/**
 * Build extruded "cut volumes" — Three.js geometries shaped like the material
 * each cut removes. They sit at the top of the board (y=0) and extrude
 * downward (-y) by the cut depth, or all the way through for through-cuts.
 *
 * Coordinate mapping: SVG mm (origin top-left, +Y down) → Three.js (X right,
 * Y up = thickness, Z = svg-y, with the SVG centred on the board).
 */
export function buildCutVolumes(
  doc: Doc,
  board: BoardParams,
  tool: Tool,
  opts: BuildCutVolumesOptions = {},
): CutVolume[] {
  const offsetX = doc.widthMm / 2;
  const offsetZ = doc.heightMm / 2;
  const preprocess = opts.preprocessOverlaps ?? true;

  const ranked = doc.cuts
    .filter((c): c is Cut & { depthMm: number } => c.depthMm != null && c.depthMm > 0)
    .map((c) => ({ cut: c, depth: c.depthMm, footprint: cutFootprint(c, tool) }))
    .filter((entry) => entry.footprint.length > 0)
    .sort((a, b) => b.depth - a.depth); // deepest first

  const volumes: CutVolume[] = [];
  let claimed: Footprint = [];

  for (const { cut, depth, footprint } of ranked) {
    const effective = preprocess && claimed.length > 0 ? difference(footprint, claimed) : footprint;
    if (effective.length === 0) continue; // fully covered by a deeper cut already

    const isThrough = depth >= board.thicknessMm;
    const extrudeDepth = isThrough ? board.thicknessMm + THROUGH_OVERSHOOT_MM : depth;
    const geom = footprintToExtrudeGeometry(effective, extrudeDepth, offsetX, offsetZ);
    if (!geom) continue;
    volumes.push({ geometry: geom, topY: 0, bottomY: -extrudeDepth, isThrough });

    if (preprocess) {
      claimed = claimed.length === 0 ? footprint : union(claimed, footprint);
    }
    void cut; // future: per-cut metadata (cut.cutType, cut.depthMm) for UI overlays
  }

  return volumes;
}

/**
 * Convert a 2D footprint (multi-polygon, possibly with holes) into a Three.js
 * ExtrudeGeometry.
 *
 * The earcut-based extruder I tried first produced cleaner manifold meshes
 * for simple cases, but choked on the bridged outer-hole topology that
 * clipper2-js sometimes emits for annular kerfs (a single ring that traverses
 * outer + bridge + hole + bridge back). ExtrudeGeometry handles these inputs
 * transparently, at the cost of occasionally generating a thin non-manifold
 * sliver after CSG. The visual cost there is much lower than getting the
 * cut shape wrong outright.
 */
function footprintToExtrudeGeometry(
  footprint: Footprint,
  depth: number,
  offsetX: number,
  offsetZ: number,
): ExtrudeGeometry | null {
  const shapes: Shape[] = [];
  for (const polygon of footprint) {
    if (polygon.length === 0) continue;
    const exterior = stripClosingDuplicate(polygon[0]);
    if (exterior.length < 3) continue;

    const shape = new Shape();
    moveTo(shape, exterior[0], offsetX, offsetZ);
    for (let i = 1; i < exterior.length; i++) lineTo(shape, exterior[i], offsetX, offsetZ);

    for (let i = 1; i < polygon.length; i++) {
      const hole = stripClosingDuplicate(polygon[i]);
      if (hole.length < 3) continue;
      const holePath = new ThreePath();
      moveTo(holePath, hole[0], offsetX, offsetZ);
      for (let j = 1; j < hole.length; j++) lineTo(holePath, hole[j], offsetX, offsetZ);
      shape.holes.push(holePath);
    }
    shapes.push(shape);
  }
  if (shapes.length === 0) return null;
  return new ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

function stripClosingDuplicate(
  ring: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function moveTo(s: Shape | ThreePath, p: readonly [number, number], ox: number, oz: number) {
  s.moveTo(p[0] - ox, p[1] - oz);
}

function lineTo(s: Shape | ThreePath, p: readonly [number, number], ox: number, oz: number) {
  s.lineTo(p[0] - ox, p[1] - oz);
}

/** Stats summary for the sidebar. */
export function summariseCuts(doc: Doc): { type: Cut["cutType"]; count: number }[] {
  const counts = new Map<Cut["cutType"], number>();
  for (const c of doc.cuts) counts.set(c.cutType, (counts.get(c.cutType) ?? 0) + 1);
  return Array.from(counts, ([type, count]) => ({ type, count })).sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}
