import { BufferGeometry, Float32BufferAttribute } from "three";
import type { BoardParams, DepthField } from "../depth";

/**
 * Build a Three.js BufferGeometry of the board with cuts applied, from a
 * rasterised depth field.
 *
 * Algorithm: each row of the depth field is run-length-encoded into wide
 * top/bottom quads spanning the longest stretch of constant-depth cells.
 * Walls between cells of differing depth are emitted similarly — east walls
 * are RLE'd along the Z axis at each column boundary, south walls along X
 * at each row boundary. For a board where most cells are uncut (typical),
 * this drops the triangle count from ~cells×4 to ~runs×4, which is one or
 * two orders of magnitude smaller, and lets us run finer raster pitches
 * without exploding the mesh.
 *
 * Through cells (depth ≥ thickness) get no top or bottom quad — that's how
 * the hole opens. Their boundary walls span 0..thickness, forming the inside
 * face of the hole.
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
  const THROUGH_EPS = 1e-6;

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
    if (r < 0 || r >= rows || c < 0 || c >= cols) return 0;
    return Math.min(depthMm[r * cols + c], thickness);
  };
  const isThroughAt = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && depthMm[r * cols + c] >= thickness - THROUGH_EPS;

  // ------ Top + bottom faces, row-wise RLE ------
  for (let r = 0; r < rows; r++) {
    const z0 = -hHalf + r * mmPerPx;
    const z1 = z0 + mmPerPx;
    let c = 0;
    while (c < cols) {
      const d = depthAt(r, c);
      const through = isThroughAt(r, c);
      let cEnd = c + 1;
      while (cEnd < cols && depthAt(r, cEnd) === d && isThroughAt(r, cEnd) === through) {
        cEnd++;
      }
      if (!through) {
        const x0 = -wHalf + c * mmPerPx;
        const x1 = -wHalf + cEnd * mmPerPx;
        const yTop = -d;
        // Top face. CCW from above (+Y).
        pushQuad([x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0]);
        // Bottom face. CCW from below (-Y).
        pushQuad(
          [x0, -thickness, z0],
          [x1, -thickness, z0],
          [x1, -thickness, z1],
          [x0, -thickness, z1],
        );
      }
      c = cEnd;
    }
  }

  // ------ East walls (vertical, between cell columns), Z-axis RLE ------
  // Boundary at x = -wHalf + (c+1) * mmPerPx, between column c (west) and c+1 (east).
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const dW = depthAt(r, c);
      const dE = depthAt(r, c + 1);
      if (dW === dE) {
        r++;
        continue;
      }
      let rEnd = r + 1;
      while (rEnd < rows && depthAt(rEnd, c) === dW && depthAt(rEnd, c + 1) === dE) {
        rEnd++;
      }
      const x = -wHalf + (c + 1) * mmPerPx;
      const zStart = -hHalf + r * mmPerPx;
      const zEnd = -hHalf + rEnd * mmPerPx;
      const deep = Math.max(dW, dE);
      const shallow = Math.min(dW, dE);
      if (dE > dW) {
        // East cell deeper, normal +X.
        pushQuad([x, -shallow, zStart], [x, -shallow, zEnd], [x, -deep, zEnd], [x, -deep, zStart]);
      } else {
        // West cell deeper, normal -X.
        pushQuad([x, -shallow, zEnd], [x, -shallow, zStart], [x, -deep, zStart], [x, -deep, zEnd]);
      }
      r = rEnd;
    }
  }

  // ------ South walls (vertical, between cell rows), X-axis RLE ------
  // Boundary at z = -hHalf + (r+1) * mmPerPx, between row r (north) and r+1 (south).
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const dN = depthAt(r, c);
      const dS = depthAt(r + 1, c);
      if (dN === dS) {
        c++;
        continue;
      }
      let cEnd = c + 1;
      while (cEnd < cols && depthAt(r, cEnd) === dN && depthAt(r + 1, cEnd) === dS) {
        cEnd++;
      }
      const z = -hHalf + (r + 1) * mmPerPx;
      const xStart = -wHalf + c * mmPerPx;
      const xEnd = -wHalf + cEnd * mmPerPx;
      const deep = Math.max(dN, dS);
      const shallow = Math.min(dN, dS);
      if (dS > dN) {
        // South cell deeper, normal +Z.
        pushQuad([xEnd, -shallow, z], [xStart, -shallow, z], [xStart, -deep, z], [xEnd, -deep, z]);
      } else {
        // North cell deeper, normal -Z.
        pushQuad([xStart, -shallow, z], [xEnd, -shallow, z], [xEnd, -deep, z], [xStart, -deep, z]);
      }
      c = cEnd;
    }
  }

  // ------ Outer board walls (CCW from outside) ------
  pushQuad(
    [wHalf, 0, -hHalf],
    [wHalf, 0, hHalf],
    [wHalf, -thickness, hHalf],
    [wHalf, -thickness, -hHalf],
  );
  pushQuad(
    [-wHalf, 0, hHalf],
    [-wHalf, 0, -hHalf],
    [-wHalf, -thickness, -hHalf],
    [-wHalf, -thickness, hHalf],
  );
  pushQuad(
    [wHalf, 0, hHalf],
    [-wHalf, 0, hHalf],
    [-wHalf, -thickness, hHalf],
    [wHalf, -thickness, hHalf],
  );
  pushQuad(
    [-wHalf, 0, -hHalf],
    [wHalf, 0, -hHalf],
    [wHalf, -thickness, -hHalf],
    [-wHalf, -thickness, -hHalf],
  );

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}
