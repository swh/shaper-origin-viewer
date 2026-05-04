import {
  ClipType,
  type ClipperLibWrapper,
  EndType,
  JoinType,
  NativeClipperLibRequestedFormat,
  PolyFillType,
  loadNativeClipperLibInstanceAsync,
} from "js-angusj-clipper";
import type { Ring } from "../parser/types";
import type { Footprint } from "./types";

// Integer-coord scale: 1 internal unit = 0.001 mm.
const SCALE = 1000;
const ARC_TOLERANCE = 50;
const MITER_LIMIT = 2;

type ClipperPoint = { x: number; y: number };
type ClipperPath = ClipperPoint[];

// js-angusj-clipper requires async init (it loads asm.js / WASM under the hood).
// We fire the load eagerly at module import and have every offset/boolean call
// gate on the resulting promise. clipper2-js was tried first but has multiple
// production-blocking bugs in v1.2.4: positive-delta InflatePaths produces
// self-intersecting paths for moderately-sized rectangles, and negative-delta
// InflatePaths returns translated/distorted shapes instead of uniform shrinkage.
// js-angusj-clipper handles both correctly.
let clipperPromise: Promise<ClipperLibWrapper> | null = null;
function getClipper(): Promise<ClipperLibWrapper> {
  if (!clipperPromise) {
    clipperPromise = loadNativeClipperLibInstanceAsync(
      NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
    );
  }
  return clipperPromise;
}

/** Eagerly preload the clipper instance. Resolves when the lib is ready to use. */
export function preloadClipper(): Promise<unknown> {
  return getClipper();
}

let clipperInstance: ClipperLibWrapper | null = null;
// Resolved synchronously after preload; used by the sync API below.
getClipper().then((c) => {
  clipperInstance = c;
});

function clipperOrThrow(): ClipperLibWrapper {
  if (!clipperInstance) {
    throw new Error(
      "clipper not loaded yet — call await preloadClipper() before any sync depth-field op",
    );
  }
  return clipperInstance;
}

// --------------------------------------------------------------------------- //

function ringToPath(ring: Ring): ClipperPath {
  // Strip a trailing closing-duplicate vertex if present.
  let n = ring.length;
  if (n >= 2) {
    const first = ring[0];
    const last = ring[n - 1];
    if (first[0] === last[0] && first[1] === last[1]) n -= 1;
  }
  const out: ClipperPath = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { x: Math.round(ring[i][0] * SCALE), y: Math.round(ring[i][1] * SCALE) };
  }
  return out;
}

function pathToRing(path: ClipperPath): Ring {
  return path.map((p) => [p.x / SCALE, p.y / SCALE] as const);
}

function flatten(fp: Footprint): ClipperPath[] {
  const out: ClipperPath[] = [];
  for (const polygon of fp) {
    for (const ring of polygon) out.push(ringToPath(ring));
  }
  return out;
}

function pathsToFootprint(paths: ClipperPath[]): Footprint {
  if (paths.length === 0) return [];
  return paths.map((p) => [pathToRing(p)]);
}

function ringSignedAreaPts(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// --------------------------------------------------------------------------- //

/**
 * Buffer a closed-polygon footprint by `offsetMm` (positive expands, negative
 * shrinks). Implemented via js-angusj-clipper's offsetToPaths.
 */
export function bufferPolygon(fp: Footprint, offsetMm: number): Footprint {
  if (offsetMm === 0 || fp.length === 0) return fp;
  const subj = flatten(fp);
  if (subj.length === 0) return [];
  const c = clipperOrThrow();
  const result = c.offsetToPaths({
    delta: offsetMm * SCALE,
    miterLimit: MITER_LIMIT,
    arcTolerance: ARC_TOLERANCE,
    offsetInputs: subj.map((path) => ({
      data: path,
      joinType: JoinType.Round,
      endType: EndType.ClosedPolygon,
    })),
  });
  return pathsToFootprint(result ?? []);
}

/** Stroke a polyline (open or closed) by `widthMm`, with rounded caps and joins. */
export function bufferPolyline(ring: Ring, widthMm: number, closed: boolean): Footprint {
  if (ring.length < 2 || widthMm <= 0) return [];
  const path = ringToPath(ring);
  const c = clipperOrThrow();
  // delta is half-width for open paths in angusj-clipper too (the offset is
  // applied to each side of the line); pass widthMm/2 so the resulting stroke
  // has full width = widthMm.
  const result = c.offsetToPaths({
    delta: (widthMm / 2) * SCALE,
    miterLimit: MITER_LIMIT,
    arcTolerance: ARC_TOLERANCE,
    offsetInputs: [
      {
        data: path,
        joinType: JoinType.Round,
        endType: closed ? EndType.ClosedLine : EndType.OpenRound,
      },
    ],
  });
  return pathsToFootprint(result ?? []);
}

/** Boolean A − B. */
export function difference(a: Footprint, b: Footprint): Footprint {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  const c = clipperOrThrow();
  const result = c.clipToPaths({
    clipType: ClipType.Difference,
    subjectFillType: PolyFillType.NonZero,
    subjectInputs: flatten(a).map((path) => ({ data: path, closed: true })),
    clipInputs: flatten(b).map((path) => ({ data: path })),
  });
  return pathsToFootprint(result ?? []);
}

/** Boolean A ∪ B. */
export function union(a: Footprint, b: Footprint): Footprint {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const c = clipperOrThrow();
  const result = c.clipToPaths({
    clipType: ClipType.Union,
    subjectFillType: PolyFillType.NonZero,
    subjectInputs: flatten(a).map((path) => ({ data: path, closed: true })),
    clipInputs: flatten(b).map((path) => ({ data: path })),
  });
  return pathsToFootprint(result ?? []);
}

/**
 * Total area of a footprint in mm². Sums signed ring areas before taking
 * absolute value.
 */
export function footprintArea(fp: Footprint): number {
  let signed = 0;
  for (const polygon of fp) {
    for (const ring of polygon) signed += ringSignedAreaPts(ring);
  }
  return Math.abs(signed);
}
