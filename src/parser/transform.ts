import type { Point } from "./types";

// 2D affine matrix
//   | a c e |
//   | b d f |
//   | 0 0 1 |
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0] as const;

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f] as const;
}

const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/g;

export function parseTransform(text: string | null | undefined): Matrix {
  if (!text) return IDENTITY;
  let result: Matrix = IDENTITY;
  TRANSFORM_RE.lastIndex = 0;
  for (const m of text.matchAll(TRANSFORM_RE)) {
    const op = m[1];
    const args = m[2]
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number.parseFloat);
    let next: Matrix;
    switch (op) {
      case "matrix": {
        if (args.length !== 6) throw new Error(`matrix() needs 6 args, got ${args.length}`);
        next = args as unknown as Matrix;
        break;
      }
      case "translate": {
        const [tx, ty = 0] = args;
        next = [1, 0, 0, 1, tx, ty];
        break;
      }
      case "scale": {
        const [sx, sy = sx] = args;
        next = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case "rotate": {
        const [a, cx = 0, cy = 0] = args;
        const r = (a * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        next =
          cx || cy ? multiply([1, 0, 0, 1, cx, cy], multiply(rot, [1, 0, 0, 1, -cx, -cy])) : rot;
        break;
      }
      case "skewX": {
        const t = Math.tan((args[0] * Math.PI) / 180);
        next = [1, 0, t, 1, 0, 0];
        break;
      }
      case "skewY": {
        const t = Math.tan((args[0] * Math.PI) / 180);
        next = [1, t, 0, 1, 0, 0];
        break;
      }
      default:
        continue;
    }
    result = multiply(result, next);
  }
  return result;
}
