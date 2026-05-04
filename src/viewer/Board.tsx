import { useMemo } from "react";
import {
  BoxGeometry,
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
import type { RenderMode } from "../store";
import { buildCsgMesh } from "./csg";
import { buildCutVolumes } from "./cuts";
import { buildHeightmapMesh } from "./heightmap";
import { type Species, speciesById } from "./species";

type Props = {
  doc: Doc | null;
  board: BoardParams;
  tool: Tool;
  speciesId: string;
  renderMode: RenderMode;
  debugCutVolumes?: boolean;
};

const RASTER_PITCH_MM = 0.1;

export function Board({ doc, board, tool, speciesId, renderMode, debugCutVolumes }: Props) {
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
            renderMode,
          ),
    [doc, widthMm, heightMm, thicknessMm, diameterMm, profile, speciesId, renderMode, debug],
  );

  return <primitive object={node} />;
}

function buildBoardMesh(
  doc: Doc | null,
  board: BoardParams,
  tool: Tool,
  species: Species,
  mode: RenderMode,
): Mesh {
  const material = new MeshStandardMaterial({
    color: species.color,
    roughness: species.roughness,
    metalness: species.metalness,
  });

  if (mode === "csg") {
    return buildCsgMesh(doc, board, tool, material);
  }

  if (!doc) {
    // Empty board: skip the heightmap raster and emit a plain box. Top at y=0,
    // bottom at y=-thickness to match the heightmap's coordinate convention.
    const geom = new BoxGeometry(board.widthMm, board.thicknessMm, board.heightMm);
    geom.translate(0, -board.thicknessMm / 2, 0);
    return new Mesh(geom, material);
  }

  const field = renderDepth(doc, board, { pitchMm: RASTER_PITCH_MM, tool });
  const geom = buildHeightmapMesh(field, board);
  return new Mesh(geom, material);
}

/**
 * Show the raw extruded volume of every cut as a single translucent overlay.
 * Useful for understanding which cut produces which feature, especially when
 * a cut renders unexpectedly in the main view.
 */
function buildDebugCutVolumes(doc: Doc | null, board: BoardParams, tool: Tool): Group {
  const group = new ThreeGroup();
  if (!doc) return group;
  const volumes = buildCutVolumes(doc, board, tool);
  const ROT = new Matrix4().makeRotationX(Math.PI / 2);
  const cutColor = new Color("#ffaa33");
  for (const v of volumes) {
    const g = v.geometry.clone();
    g.applyMatrix4(ROT);
    const mat = new MeshBasicMaterial({
      color: cutColor,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      wireframe: false,
    });
    group.add(new Mesh(g, mat));
  }
  return group;
}
