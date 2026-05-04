import type { Doc } from "../parser";
import { cutFootprint } from "./footprint";
import { DEFAULT_TOOL, type Footprint, type Tool } from "./types";

export type DepthField = {
  depthMm: Float32Array;
  cols: number;
  rows: number;
  mmPerPx: number;
  boardWidthMm: number;
  boardHeightMm: number;
  boardThicknessMm: number;
};

export type BoardParams = {
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
};

export type RasterParams = {
  pitchMm?: number; // grid spacing in mm; defaults to 0.5
  tool?: Tool;
  /**
   * Where on the board to place the SVG, in board-mm. The SVG's (0, 0) lands
   * here. Defaults to centring the SVG on the board.
   */
  origin?: { x: number; y: number };
};

const DEFAULT_PITCH_MM = 0.5;

/**
 * Rasterise each cut's 2D footprint into a depth field, compositing by max
 * (deepest cut wins per pixel). Mirrors `python-reference/.../depth.py::render_depth`.
 *
 * Depth is clamped to board thickness on the way out.
 */
export function renderDepth(doc: Doc, board: BoardParams, params: RasterParams = {}): DepthField {
  const pitch = params.pitchMm ?? DEFAULT_PITCH_MM;
  const tool = params.tool ?? DEFAULT_TOOL;
  const origin = params.origin ?? {
    x: (board.widthMm - doc.widthMm) / 2,
    y: (board.heightMm - doc.heightMm) / 2,
  };

  const cols = Math.max(1, Math.ceil(board.widthMm / pitch));
  const rows = Math.max(1, Math.ceil(board.heightMm / pitch));

  const depthMm = new Float32Array(cols * rows);

  // OffscreenCanvas is available in modern browsers and our test env (happy-dom).
  // Fall back to document.createElement('canvas') if needed.
  const canvas = makeCanvas(cols, rows);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("could not acquire 2D rendering context for depth raster");

  for (const cut of doc.cuts) {
    if (cut.depthMm == null || cut.depthMm <= 0) continue;
    const fp = cutFootprint(cut, tool);
    if (fp.length === 0) continue;

    ctx.clearRect(0, 0, cols, rows);
    drawFootprint(ctx, fp, origin.x, origin.y, pitch);
    ctx.fillStyle = "#fff";
    // `nonzero` respects winding direction. clipper2-js emits annular kerfs
    // as a single bridged ring with the outer traversed CCW (positive
    // winding) and the inner traversed CW (negative winding). Net winding
    // inside the kerf = +1 (filled), inside the hole = +1 - 1 = 0 (unfilled).
    ctx.fill("nonzero");

    const img = ctx.getImageData(0, 0, cols, rows);
    const px = img.data;
    const cutDepth = Math.min(cut.depthMm, board.thicknessMm);
    for (let i = 0, p = 3; i < depthMm.length; i++, p += 4) {
      if (px[p] !== 0 && cutDepth > depthMm[i]) depthMm[i] = cutDepth;
    }
  }

  return {
    depthMm,
    cols,
    rows,
    mmPerPx: pitch,
    boardWidthMm: board.widthMm,
    boardHeightMm: board.heightMm,
    boardThicknessMm: board.thicknessMm,
  };
}

function drawFootprint(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  fp: Footprint,
  originX: number,
  originY: number,
  pitch: number,
): void {
  ctx.beginPath();
  for (const polygon of fp) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      const [x0, y0] = ring[0];
      ctx.moveTo((x0 + originX) / pitch, (y0 + originY) / pitch);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i];
        ctx.lineTo((x + originX) / pitch, (y + originY) / pitch);
      }
      ctx.closePath();
    }
  }
}

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  throw new Error("no Canvas implementation available in this environment");
}
