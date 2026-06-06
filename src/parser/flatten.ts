import { SVGPathData, SVGPathDataTransformer } from "svg-pathdata";
import type { Matrix } from "./transform";
import type { Point } from "./types";

const CHORD_TOL_MM = 0.05;
const CLOSURE_TOL_MM = 1e-6;

export type FlattenedPath = {
  rings: Point[][]; // one entry per subpath
  closures: boolean[]; // parallel to rings
};

/**
 * Flatten an SVG path d-string into a list of polyline rings, after applying
 * the supplied affine matrix. Curves (cubic/quadratic) are sampled to lines
 * with adaptive step count targeting CHORD_TOL_MM chord error.
 *
 * The returned coordinates are in whatever units `transform` lands in — for
 * the parser pipeline that's millimetres, top-left origin, +Y down.
 */
export function flattenPath(d: string, transform: Matrix): FlattenedPath {
  const data = new SVGPathData(d)
    .toAbs()
    .normalizeST()
    .aToC()
    .transform(SVGPathDataTransformer.MATRIX(...transform));

  const rings: Point[][] = [];
  const closures: boolean[] = [];
  let current: Point[] = [];
  let closed = false;
  let cx = 0;
  let cy = 0;

  const finishRing = () => {
    if (current.length > 0) {
      // Treat a subpath whose last point coincides with its first as closed,
      // even without an explicit Z. Shaper Studio itself emits rounded
      // rectangles this way (M … L x0,y0 with no trailing Z).
      if (!closed && current.length >= 3) {
        const first = current[0];
        const last = current[current.length - 1];
        if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= CLOSURE_TOL_MM) {
          closed = true;
        }
      }
      rings.push(current);
      closures.push(closed);
    }
    current = [];
    closed = false;
  };

  for (const cmd of data.commands) {
    switch (cmd.type) {
      case SVGPathData.MOVE_TO: {
        finishRing();
        cx = cmd.x;
        cy = cmd.y;
        current.push([cx, cy] as const);
        break;
      }
      case SVGPathData.LINE_TO: {
        cx = cmd.x;
        cy = cmd.y;
        current.push([cx, cy] as const);
        break;
      }
      case SVGPathData.HORIZ_LINE_TO: {
        cx = cmd.x;
        current.push([cx, cy] as const);
        break;
      }
      case SVGPathData.VERT_LINE_TO: {
        cy = cmd.y;
        current.push([cx, cy] as const);
        break;
      }
      case SVGPathData.CURVE_TO: {
        flattenCubic([cx, cy], [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y], current);
        cx = cmd.x;
        cy = cmd.y;
        break;
      }
      case SVGPathData.QUAD_TO: {
        flattenQuad([cx, cy], [cmd.x1, cmd.y1], [cmd.x, cmd.y], current);
        cx = cmd.x;
        cy = cmd.y;
        break;
      }
      case SVGPathData.CLOSE_PATH: {
        closed = true;
        if (current.length > 0) {
          const first = current[0];
          const last = current[current.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            current.push([first[0], first[1]] as const);
          }
          cx = first[0];
          cy = first[1];
        }
        break;
      }
      default:
        throw new Error(`unsupported path command after pipeline: type=${cmd.type}`);
    }
  }
  finishRing();
  return { rings, closures };
}

const MAX_RECURSION = 16;

/**
 * Recursive de Casteljau subdivision until the chord error stays below
 * CHORD_TOL_MM. Cheap on near-flat cubics (no subdivision), tight on curvy ones.
 */
function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[]): void {
  flattenCubicRec(p0, p1, p2, p3, out, 0);
  out.push([p3[0], p3[1]] as const);
}

function flattenCubicRec(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  out: Point[],
  depth: number,
): void {
  if (depth >= MAX_RECURSION || isCubicFlat(p0, p1, p2, p3)) return;
  const m01 = mid(p0, p1);
  const m12 = mid(p1, p2);
  const m23 = mid(p2, p3);
  const m012 = mid(m01, m12);
  const m123 = mid(m12, m23);
  const m0123 = mid(m012, m123);
  flattenCubicRec(p0, m01, m012, m0123, out, depth + 1);
  out.push(m0123);
  flattenCubicRec(m0123, m123, m23, p3, out, depth + 1);
}

function flattenQuad(p0: Point, p1: Point, p2: Point, out: Point[]): void {
  flattenQuadRec(p0, p1, p2, out, 0);
  out.push([p2[0], p2[1]] as const);
}

function flattenQuadRec(p0: Point, p1: Point, p2: Point, out: Point[], depth: number): void {
  if (depth >= MAX_RECURSION || isQuadFlat(p0, p1, p2)) return;
  const m01 = mid(p0, p1);
  const m12 = mid(p1, p2);
  const m012 = mid(m01, m12);
  flattenQuadRec(p0, m01, m012, out, depth + 1);
  out.push(m012);
  flattenQuadRec(m012, m12, p2, out, depth + 1);
}

function mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
}

/**
 * Return true if the perpendicular distance from each interior control point
 * to the chord (p0–p3) is below CHORD_TOL_MM. This is a tight upper bound on
 * the chord error of approximating the cubic with a single line segment.
 */
function isCubicFlat(p0: Point, p1: Point, p2: Point, p3: Point): boolean {
  return distFromLine(p1, p0, p3) <= CHORD_TOL_MM && distFromLine(p2, p0, p3) <= CHORD_TOL_MM;
}

function isQuadFlat(p0: Point, p1: Point, p2: Point): boolean {
  return distFromLine(p1, p0, p2) <= CHORD_TOL_MM;
}

function distFromLine(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}
