import { BufferGeometry, Float32BufferAttribute } from "three";
import type { BoardParams, DepthField } from "../depth";

/**
 * Build a Three.js BufferGeometry of the board with cuts applied, from a
 * rasterised depth field.
 *
 * Algorithm: each cell of the depth field becomes a flat top quad at its
 * cut depth. Where adjacent cells differ in depth, a vertical wall quad
 * is added. Add the four outer walls and the bottom of the board. No CSG
 * involved — purely additive mesh construction, which is robust against
 * the topological edge cases that broke the polygon-CSG pipeline.
 *
 * Coordinate convention: SVG-mm flat-laid in the XZ plane, +Y is the
 * board's thickness direction. Top of the board sits at y=0; bottom at
 * y=-thickness. Cut depths displace the top face downward.
 */
export function buildHeightmapMesh(field: DepthField, board: BoardParams): BufferGeometry {
  const { depthMm, cols, rows, mmPerPx } = field;
  const wHalf = board.widthMm / 2;
  const hHalf = board.heightMm / 2;
  const thickness = board.thicknessMm;

  const positions: number[] = [];
  const indices: number[] = [];

  function pushQuad(
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
  ): void {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const depthAt = (r: number, c: number): number => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return 0; // outside board = uncut surface
    return Math.min(depthMm[r * cols + c], thickness);
  };

  // Top quads + interior walls
  for (let r = 0; r < rows; r++) {
    const z0 = -hHalf + r * mmPerPx;
    const z1 = z0 + mmPerPx;
    for (let c = 0; c < cols; c++) {
      const d = depthAt(r, c);
      const yTop = -d;
      const x0 = -wHalf + c * mmPerPx;
      const x1 = x0 + mmPerPx;

      // Top face. CCW from above (+Y view) so the up-facing normal computes correctly.
      pushQuad([x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0]);

      // East wall (between this cell and east neighbour).
      const dE = depthAt(r, c + 1);
      if (dE !== d) {
        const deep = Math.max(d, dE);
        const shallow = Math.min(d, dE);
        if (dE > d) {
          // East cell is deeper. Material on west side, empty on east. Normal +X.
          pushQuad([x1, -shallow, z0], [x1, -shallow, z1], [x1, -deep, z1], [x1, -deep, z0]);
        } else {
          // West (this) cell is deeper. Normal -X.
          pushQuad([x1, -shallow, z1], [x1, -shallow, z0], [x1, -deep, z0], [x1, -deep, z1]);
        }
      }

      // South wall (between this cell and south neighbour).
      const dS = depthAt(r + 1, c);
      if (dS !== d) {
        const deep = Math.max(d, dS);
        const shallow = Math.min(d, dS);
        if (dS > d) {
          // South cell is deeper. Material on north (this) side. Normal +Z.
          pushQuad([x1, -shallow, z1], [x0, -shallow, z1], [x0, -deep, z1], [x1, -deep, z1]);
        } else {
          // North (this) cell is deeper. Normal -Z.
          pushQuad([x0, -shallow, z1], [x1, -shallow, z1], [x1, -deep, z1], [x0, -deep, z1]);
        }
      }
    }
  }

  // Outer board walls (full thickness, around the board perimeter).
  // +X face (east wall of board)
  pushQuad(
    [wHalf, 0, hHalf],
    [wHalf, 0, -hHalf],
    [wHalf, -thickness, -hHalf],
    [wHalf, -thickness, hHalf],
  );
  // -X face (west wall)
  pushQuad(
    [-wHalf, 0, -hHalf],
    [-wHalf, 0, hHalf],
    [-wHalf, -thickness, hHalf],
    [-wHalf, -thickness, -hHalf],
  );
  // +Z face (south wall) — uses our convention of z=+hHalf at south
  pushQuad(
    [-wHalf, 0, hHalf],
    [wHalf, 0, hHalf],
    [wHalf, -thickness, hHalf],
    [-wHalf, -thickness, hHalf],
  );
  // -Z face (north wall)
  pushQuad(
    [wHalf, 0, -hHalf],
    [-wHalf, 0, -hHalf],
    [-wHalf, -thickness, -hHalf],
    [wHalf, -thickness, -hHalf],
  );
  // Bottom face (-Y normal)
  pushQuad(
    [-wHalf, -thickness, hHalf],
    [wHalf, -thickness, hHalf],
    [wHalf, -thickness, -hHalf],
    [-wHalf, -thickness, -hHalf],
  );

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}
