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
  /** Per-cut tool diameter overrides, keyed by index in `doc.cuts`. */
  cutOverrides?: Record<number, number>;
  /** Fallback depth for cuts without `shaper:cutDepth` (mm). Default 2. */
  defaultDepthMm?: number;
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

  const defaultDepth = params.defaultDepthMm ?? 2;
  for (const [i, cut] of doc.cuts.entries()) {
    // Default depth for cuts without a shaper:cutDepth attribute (common in
    // plain Inkscape exports) — falls back to the caller-supplied default.
    const effectiveDepth = cut.depthMm ?? defaultDepth;
    if (effectiveDepth <= 0) continue;
    const fp = cutFootprint(cut, tool, params.cutOverrides?.[i], defaultDepth);
    if (fp.length === 0) continue;

    // Clip work to this cut's footprint AABB. Most cuts cover a tiny fraction
    // of the board, so getImageData + the per-pixel scan dominate cost when
    // they run over the full canvas. The fill itself is bounded by the polygon
    // anyway, so painting outside the bbox can't happen — we just need to
    // clear that region first.
    const bbox = footprintBboxPx(fp, origin, pitch, cols, rows);
    if (!bbox) continue;
    const { x: bx, y: by, w: bw, h: bh } = bbox;

    ctx.clearRect(bx, by, bw, bh);
    drawFootprint(ctx, fp, origin.x, origin.y, pitch);
    ctx.fillStyle = "#fff";
    // `nonzero` respects winding direction. Annular kerfs traverse the outer
    // CCW (winding +1) and inner CW (-1); net inside the kerf = +1 (filled),
    // inside the hole = 0 (unfilled).
    ctx.fill("nonzero");

    const img = ctx.getImageData(bx, by, bw, bh);
    const px = img.data;
    const cutDepth = Math.min(effectiveDepth, board.thicknessMm);
    for (let dy = 0; dy < bh; dy++) {
      const rowBase = (by + dy) * cols + bx;
      const pxRowBase = dy * bw * 4 + 3; // alpha byte of column 0
      for (let dx = 0; dx < bw; dx++) {
        if (px[pxRowBase + dx * 4] !== 0) {
          const i = rowBase + dx;
          if (cutDepth > depthMm[i]) depthMm[i] = cutDepth;
        }
      }
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

/**
 * Pixel-space AABB of a footprint, clamped to the canvas. Returns null if the
 * footprint is empty or lies entirely outside the canvas.
 */
function footprintBboxPx(
  fp: Footprint,
  origin: { x: number; y: number },
  pitch: number,
  cols: number,
  rows: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polygon of fp) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;

  // 1-pixel pad to absorb rounding and Canvas2D antialiased edges.
  const PAD = 1;
  const x0 = Math.max(0, Math.floor((minX + origin.x) / pitch) - PAD);
  const y0 = Math.max(0, Math.floor((minY + origin.y) / pitch) - PAD);
  const x1 = Math.min(cols, Math.ceil((maxX + origin.x) / pitch) + PAD);
  const y1 = Math.min(rows, Math.ceil((maxY + origin.y) / pitch) + PAD);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  return { x: x0, y: y0, w, h };
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
