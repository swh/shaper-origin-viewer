import type { Cut, Geometry, Ring } from "../parser/types";
import { bufferPolygon, bufferPolyline } from "./clipper";
import { DEFAULT_TOOL, EMPTY_FOOTPRINT, type Footprint, type Tool } from "./types";

/**
 * The 2D region this cut removes from the top surface, in board-mm coords.
 *
 * Encoding the offset rule once: positive `offsetMm` eats into the **kept**
 * side of the cut line. The kept side depends on the cut type:
 *
 *   pocket   kept = outside polygon → +o expands the polygon outward
 *   inside   kept = outside polygon → +o shifts the kerf outward (hole grows)
 *   outside  kept = inside polygon  → +o shifts the kerf inward (part shrinks)
 *   online   no kept side defined   → offset must already be 0 (parser enforces)
 */
export function cutFootprint(cut: Cut, defaultTool: Tool = DEFAULT_TOOL): Footprint {
  const toolDia = cut.toolDiaMm ?? defaultTool.diameterMm;
  const o = cut.offsetMm;

  switch (cut.cutType) {
    case "pocket":
      return polygonAsFootprint(cut.geometry).length === 0
        ? EMPTY_FOOTPRINT
        : bufferPolygon(polygonAsFootprint(cut.geometry), o);

    case "inside": {
      // Kerf = (polygon expanded by o) ∖ (polygon expanded by o − toolDia).
      // We compute outer and inner separately and assemble as a polygon-with-
      // hole rather than calling clipper Difference. clipper's Difference on
      // these inputs occasionally returns a single self-touching ring with
      // degenerate edges that no Canvas2D fill rule renders correctly.
      return annular(polygonAsFootprint(cut.geometry), o, o - toolDia);
    }

    case "outside": {
      return annular(polygonAsFootprint(cut.geometry), toolDia - o, -o);
    }

    case "online":
      if (cut.geometry.kind === "linestring") {
        return bufferPolyline(cut.geometry.points, toolDia, false);
      }
      // Closed `online`: stroke the boundary as a closed loop.
      return bufferPolyline(cut.geometry.rings[0], toolDia, true);

    case "guide":
    case "anchor":
      return EMPTY_FOOTPRINT;
  }
}

/**
 * Build an annular footprint = (base buffered by `outerOffset`) ∖
 * (base buffered by `innerOffset`), assembled as polygon-with-holes.
 *
 * Each polygon of the outer buffer becomes one Footprint polygon. The inner
 * buffer's exterior rings are reversed and attached as holes. This skips
 * clipper2-js's Difference operation, which sometimes returns the kerf as a
 * single bridged ring with degenerate edges that don't rasterise cleanly.
 */
function annular(base: Footprint, outerOffset: number, innerOffset: number): Footprint {
  if (base.length === 0) return EMPTY_FOOTPRINT;
  const outer = bufferPolygon(base, outerOffset);
  const inner = bufferPolygon(base, innerOffset);
  if (outer.length === 0) return EMPTY_FOOTPRINT;
  if (inner.length === 0) return outer;

  // Treat each inner polygon's exterior ring as a hole — reverse its winding
  // so it cancels properly under the nonzero fill rule.
  const holes: Ring[] = inner.flatMap((poly) => (poly.length > 0 ? [reverseRing(poly[0])] : []));

  return outer.map((outerPoly) => [...outerPoly, ...holes]);
}

function reverseRing(ring: Ring): Ring {
  return [...ring].reverse();
}

/**
 * Convert a parsed Geometry into a clipper-ready Footprint.
 *
 * SVG paths can be wound either way (the spec doesn't pick), so the parser
 * preserves whatever orientation the file uses. clipper2-js, however, uses
 * the SIGN of each ring's signed area to decide outer vs. hole — pass it a
 * CW rectangle and it interprets the rectangle as a hole, then "buffers"
 * the surrounding empty space, which produces nonsense fins at the corners.
 *
 * Normalising here once means downstream operations get a clean
 * "exterior CCW, holes CW" footprint regardless of the SVG's choice.
 */
function polygonAsFootprint(geom: Geometry): Footprint {
  if (geom.kind !== "polygon") return EMPTY_FOOTPRINT;
  const rings = geom.rings.map((ring, i) => orientRing(ring, i === 0));
  return [rings];
}

function orientRing(ring: Ring, wantPositive: boolean): Ring {
  if (ring.length < 3) return ring;
  let signed = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    signed += x1 * y2 - x2 * y1;
  }
  const isPositive = signed > 0;
  return isPositive === wantPositive ? ring : [...ring].reverse();
}
