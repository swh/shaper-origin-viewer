import { classifyByColor } from "./colors";
import { flattenPath } from "./flatten";
import { parseLengthMm } from "./length";
import { type Matrix, multiply, parseTransform } from "./transform";
import {
  CUT_TYPES,
  type Cut,
  type CutType,
  type Doc,
  type Geometry,
  type Point,
  type Ring,
} from "./types";

const SHAPER_NS = "http://www.shapertools.com/namespaces/shaper";

export function parseSvg(text: string): Doc {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = xml.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    throw new Error("not an SVG document");
  }

  const widthMm = parseLengthMm(svg.getAttribute("width"));
  const heightMm = parseLengthMm(svg.getAttribute("height"));
  if (widthMm == null || heightMm == null) {
    throw new Error("SVG must have width and height attributes");
  }

  const vbAttr = svg.getAttribute("viewBox");
  let vbX = 0;
  let vbY = 0;
  let vbW = widthMm;
  let vbH = heightMm;
  if (vbAttr) {
    const [x, y, w, h] = vbAttr
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number.parseFloat);
    vbX = x;
    vbY = y;
    vbW = w;
    vbH = h;
  }

  // viewBox → mm: scale by mm/user-unit, translate viewBox origin to (0,0).
  const sx = widthMm / vbW;
  const sy = heightMm / vbH;
  const vbToMm: Matrix = [sx, 0, 0, sy, -sx * vbX, -sy * vbY];

  const cuts: Cut[] = [];
  let anchor: Point | null = null;

  for (const path of svg.querySelectorAll("path")) {
    const cut = parsePath(path, vbToMm, svg);
    if (cut === null) continue;
    if (cut.cutType === "anchor") {
      if (anchor !== null) throw new Error("multiple anchors are not allowed");
      if (cut.geometry.kind !== "polygon") throw new Error("anchor must be a closed polygon");
      anchor = rightAngleVertex(cut.geometry.rings[0]);
      continue;
    }
    cuts.push(cut);
  }

  return { widthMm, heightMm, cuts, anchor };
}

function parsePath(path: Element, vbToMm: Matrix, svgRoot: Element): Cut | null {
  // Accumulate ancestor transforms from root → path.
  const stack: Element[] = [];
  let el: Element | null = path;
  while (el && el !== svgRoot) {
    stack.unshift(el);
    el = el.parentElement;
  }
  let m = vbToMm;
  for (const e of stack) {
    m = multiply(m, parseTransform(e.getAttribute("transform")));
  }

  const cutTypeAttr = shaperAttr(path, "cutType");
  const fill = path.getAttribute("fill");
  const stroke = path.getAttribute("stroke");
  const fillOpacityRaw = path.getAttribute("fill-opacity");
  const fillOpacity = fillOpacityRaw == null ? 1 : Number.parseFloat(fillOpacityRaw);

  let cutType: CutType | null = null;
  if (cutTypeAttr && (CUT_TYPES as readonly string[]).includes(cutTypeAttr)) {
    cutType = cutTypeAttr as CutType;
  } else {
    cutType = classifyByColor(fill, stroke, fillOpacity);
  }
  if (cutType === null) return null;

  const d = path.getAttribute("d");
  if (!d) return null;

  const { rings, closures } = flattenPath(d, m);
  if (rings.length === 0) return null;
  const allClosed = closures.every(Boolean);

  let geometry: Geometry;
  if (allClosed) {
    if (rings.length === 1) {
      geometry = { kind: "polygon", rings };
    } else {
      // Largest by absolute signed area = exterior; rest treated as holes.
      const ordered = rings.slice().sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
      geometry = { kind: "polygon", rings: ordered };
    }
  } else {
    if (rings.length !== 1) {
      throw new Error("multi-subpath open paths are not supported");
    }
    geometry = { kind: "linestring", points: rings[0] };
  }

  if (cutType === "anchor") {
    return { cutType, depthMm: null, offsetMm: 0, toolDiaMm: null, geometry, closed: allClosed };
  }

  if (!allClosed && cutType !== "online") {
    throw new Error(`non-online cut (${cutType}) has an open path — not allowed by spec`);
  }

  const depthMm = cutType === "guide" ? null : parseLengthMm(shaperAttr(path, "cutDepth"));
  let offsetMm = parseLengthMm(shaperAttr(path, "cutOffset")) ?? 0;
  if (cutType === "online" || cutType === "guide") offsetMm = 0;
  const toolDiaMm = parseLengthMm(shaperAttr(path, "toolDia"));

  return { cutType, depthMm, offsetMm, toolDiaMm, geometry, closed: allClosed };
}

/** Read a shaper:* attribute. happy-dom's getAttributeNS doesn't honour XML namespaces, so fall back to qname. */
function shaperAttr(el: Element, localName: string): string | null {
  const ns = el.getAttributeNS?.(SHAPER_NS, localName);
  if (ns != null && ns !== "") return ns;
  const q = el.getAttribute(`shaper:${localName}`);
  return q ?? null;
}

function ringArea(ring: Ring): number {
  // Signed area via shoelace; ring may or may not be explicitly closed.
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function rightAngleVertex(triangle: Ring): Point {
  // Drop trailing closure vertex if present.
  let verts = triangle;
  if (
    verts.length >= 4 &&
    verts[0][0] === verts[verts.length - 1][0] &&
    verts[0][1] === verts[verts.length - 1][1]
  ) {
    verts = verts.slice(0, -1);
  }
  if (verts.length !== 3) {
    throw new Error(`anchor must be a triangle, got ${verts.length} vertices`);
  }
  let bestIdx = 0;
  let bestCos = 1;
  for (let i = 0; i < 3; i++) {
    const a = verts[(i + 2) % 3];
    const b = verts[i];
    const c = verts[(i + 1) % 3];
    const v1: [number, number] = [a[0] - b[0], a[1] - b[1]];
    const v2: [number, number] = [c[0] - b[0], c[1] - b[1]];
    const n1 = Math.hypot(v1[0], v1[1]) || 1;
    const n2 = Math.hypot(v2[0], v2[1]) || 1;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
    if (Math.abs(cos) < Math.abs(bestCos)) {
      bestCos = cos;
      bestIdx = i;
    }
  }
  return verts[bestIdx];
}
