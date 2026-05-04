import { BoxGeometry, type Material, Matrix4, Mesh } from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { BoardParams, Tool } from "../depth";
import type { Doc } from "../parser";
import { buildCutVolumes } from "./cuts";

/**
 * Build a polished board mesh by subtracting each cut volume from the board
 * via three-bvh-csg.
 *
 * Cut volumes come out of `buildCutVolumes` extruded along +Z (the
 * ExtrudeGeometry default); the board lives in (X, Y=thickness, Z) where Y
 * points up. Rotate the cut volumes -90° around X so their extrusion axis
 * points in -Y (downward into the board), then subtract.
 *
 * Volumes are pre-deconflicted in `buildCutVolumes` (deepest-cut-wins via
 * difference/union), so they don't overlap — that should keep CSG away from
 * the coincident-face cases that produce non-manifold output.
 */
export function buildCsgMesh(
  doc: Doc | null,
  board: BoardParams,
  tool: Tool,
  material: Material,
  origin?: { x: number; y: number },
): Mesh {
  // Board: top face at y=0, bottom at y=-thickness.
  const boardGeom = new BoxGeometry(board.widthMm, board.thicknessMm, board.heightMm);
  boardGeom.translate(0, -board.thicknessMm / 2, 0);

  if (!doc || doc.cuts.length === 0) {
    return new Mesh(boardGeom, material);
  }

  // Skip the deepest-cut-wins preprocessing. CSG handles overlapping volumes
  // (a deep through-hole inside a shallow pocket) correctly via subtraction —
  // the deeper volume removes material the shallower one would have anyway.
  // Preprocessing trims shallow cuts into polygon-with-hole donuts whose
  // bridged-ring topology three-bvh-csg drops on the floor.
  const volumes = buildCutVolumes(doc, board, tool, { preprocessOverlaps: false, origin });
  if (volumes.length === 0) {
    return new Mesh(boardGeom, material);
  }

  // Map ExtrudeGeometry's +Z extrusion onto the board's -Y depth axis.
  const ROT = new Matrix4().makeRotationX(Math.PI / 2);

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  let result = new Brush(boardGeom);
  result.updateMatrixWorld();

  for (const v of volumes) {
    const g = v.geometry.clone();
    g.applyMatrix4(ROT);
    const cut = new Brush(g);
    cut.updateMatrixWorld();
    result = evaluator.evaluate(result, cut, SUBTRACTION);
  }

  const mesh = new Mesh(result.geometry, material);
  return mesh;
}
