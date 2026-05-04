import { useMemo } from "react";
import {
  Color,
  type Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Group as ThreeGroup,
} from "three";
import { type BoardParams, type Tool, renderDepth } from "../depth";
import type { Doc } from "../parser";
import { buildCutVolumes } from "./cuts";
import { buildHeightmapMesh } from "./heightmap";
import { type Species, speciesById } from "./species";

type Props = {
  doc: Doc | null;
  board: BoardParams;
  tool: Tool;
  speciesId: string;
  debugCutVolumes?: boolean;
};

const RASTER_PITCH_MM = 0.5;

export function Board({ doc, board, tool, speciesId, debugCutVolumes }: Props) {
  const { widthMm, heightMm, thicknessMm } = board;
  const { diameterMm, profile } = tool;
  const debug = !!debugCutVolumes;

  const node = useMemo(
    () =>
      debug
        ? buildDebugCutVolumes(doc, { widthMm, heightMm, thicknessMm }, { diameterMm, profile })
        : buildBoardMesh(
            doc,
            { widthMm, heightMm, thicknessMm },
            { diameterMm, profile },
            speciesById(speciesId),
          ),
    [doc, widthMm, heightMm, thicknessMm, diameterMm, profile, speciesId, debug],
  );

  return <primitive object={node} />;
}

function buildBoardMesh(doc: Doc | null, board: BoardParams, tool: Tool, species: Species): Mesh {
  const material = new MeshStandardMaterial({
    color: species.color,
    roughness: species.roughness,
    metalness: species.metalness,
  });

  if (!doc) {
    // Empty board: a featureless heightmap with depth 0 everywhere.
    const empty = renderDepth({ widthMm: 0, heightMm: 0, cuts: [], anchor: null }, board, {
      pitchMm: Math.max(board.widthMm, board.heightMm), // single cell
    });
    return new Mesh(buildHeightmapMesh(empty, board), material);
  }

  const field = renderDepth(doc, board, { pitchMm: RASTER_PITCH_MM, tool });
  const geom = buildHeightmapMesh(field, board);
  return new Mesh(geom, material);
}

/**
 * Debug renderer: emit each cut volume as its own colored translucent mesh,
 * skipping CSG entirely. If a cut looks wrong here, the bug is upstream
 * (parser, footprint, or extruder); if it only goes wrong inside CSG, the bug
 * is downstream.
 */
function buildDebugCutVolumes(doc: Doc | null, board: BoardParams, tool: Tool): Group {
  const group = new ThreeGroup();
  if (!doc) return group;
  const volumes = buildCutVolumes(doc, board, tool);
  const palette = ["#ff5555", "#55aaff", "#88dd55", "#ffcc44", "#dd66dd", "#33dddd"];
  const ROT = new Matrix4().makeRotationX(Math.PI / 2);
  for (const [i, v] of volumes.entries()) {
    const g = v.geometry.clone();
    g.applyMatrix4(ROT);
    const mat = new MeshBasicMaterial({
      color: new Color(palette[i % palette.length]),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      wireframe: false,
    });
    group.add(new Mesh(g, mat));
  }
  return group;
}
