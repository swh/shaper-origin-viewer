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

  // Process all SVG shape primitives, not just <path>. Inkscape exports
  // routinely use <rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>
  // alongside paths.
  for (const el of svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon")) {
    const parsed = parsePath(el, vbToMm, svg);
    if (parsed === null) continue;
    for (const cut of parsed) {
      if (cut.cutType === "anchor") {
        if (anchor !== null) throw new Error("multiple anchors are not allowed");
        if (cut.geometry.kind !== "polygon") throw new Error("anchor must be a closed polygon");
        anchor = rightAngleVertex(cut.geometry.rings[0]);
        continue;
      }
      cuts.push(cut);
    }
  }

  return { widthMm, heightMm, cuts, anchor };
}

function parsePath(path: Element, vbToMm: Matrix, svgRoot: Element): Cut[] | null {
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
  const fill = presentationAttr(path, "fill");
  const stroke = presentationAttr(path, "stroke");
  const fillOpacityRaw = presentationAttr(path, "fill-opacity");
  const fillOpacity = fillOpacityRaw == null ? 1 : Number.parseFloat(fillOpacityRaw);

  let cutType: CutType | null = null;
  if (cutTypeAttr && (CUT_TYPES as readonly string[]).includes(cutTypeAttr)) {
    cutType = cutTypeAttr as CutType;
  } else {
    cutType = classifyByColor(fill, stroke, fillOpacity);
  }
  if (cutType === null) return null;

  const d = pathDataFor(path);
  if (!d) return null;

  const { rings, closures } = flattenPath(d, m);
  if (rings.length === 0) return null;
  const allClosed = closures.every(Boolean);

  // For closed paths we collapse all subpaths into one polygon (with holes).
  // For open paths each subpath becomes its own linestring cut — common in
  // line-drawing SVGs that pack many disjoint strokes into one <path d=…>.
  let geometries: Geometry[];
  if (allClosed) {
    const ordered =
      rings.length === 1
        ? rings
        : rings.slice().sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    geometries = [{ kind: "polygon", rings: ordered }];
  } else {
    geometries = rings.map((r) => ({ kind: "linestring", points: r }));
  }

  if (cutType === "anchor") {
    if (geometries.length !== 1 || geometries[0].kind !== "polygon") {
      throw new Error("anchor must be a single closed polygon");
    }
    return [
      {
        cutType,
        depthMm: null,
        offsetMm: 0,
        toolDiaMm: null,
        geometry: geometries[0],
        closed: allClosed,
      },
    ];
  }

  if (!allClosed && cutType !== "online") {
    throw new Error(`non-online cut (${cutType}) has an open path — not allowed by spec`);
  }

  const depthMm = cutType === "guide" ? null : parseLengthMm(shaperAttr(path, "cutDepth"));
  let offsetMm = parseLengthMm(shaperAttr(path, "cutOffset")) ?? 0;
  if (cutType === "online" || cutType === "guide") offsetMm = 0;
  const toolDiaMm = parseLengthMm(shaperAttr(path, "toolDia"));

  return geometries.map((geometry) => ({
    cutType,
    depthMm,
    offsetMm,
    toolDiaMm,
    geometry,
    closed: allClosed,
  }));
}

/** Read a shaper:* attribute. happy-dom's getAttributeNS doesn't honour XML namespaces, so fall back to qname. */
function shaperAttr(el: Element, localName: string): string | null {
  const ns = el.getAttributeNS?.(SHAPER_NS, localName);
  if (ns != null && ns !== "") return ns;
  const q = el.getAttribute(`shaper:${localName}`);
  return q ?? null;
}

/**
 * Synthesize an SVG path-data string for any supported shape primitive.
 * <path> uses its `d` attribute directly; <rect>/<circle>/<ellipse>/<line>/
 * <polyline>/<polygon> are converted to equivalent path commands so they go
 * through the same flattening pipeline as paths.
 */
function pathDataFor(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "path":
      return el.getAttribute("d");
    case "rect": {
      const x = numAttr(el, "x");
      const y = numAttr(el, "y");
      const w = numAttr(el, "width");
      const h = numAttr(el, "height");
      if (w <= 0 || h <= 0) return null;
      // Corner radii (rx/ry) are intentionally skipped — uncommon in CNC SVGs.
      return `M ${x},${y} H ${x + w} V ${y + h} H ${x} Z`;
    }
    case "circle": {
      const cx = numAttr(el, "cx");
      const cy = numAttr(el, "cy");
      const r = numAttr(el, "r");
      if (r <= 0) return null;
      // Two semicircle arcs to avoid the SVG ambiguity around full-circle arcs.
      return `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy} A ${r},${r} 0 0,1 ${cx - r},${cy} Z`;
    }
    case "ellipse": {
      const cx = numAttr(el, "cx");
      const cy = numAttr(el, "cy");
      const rx = numAttr(el, "rx");
      const ry = numAttr(el, "ry");
      if (rx <= 0 || ry <= 0) return null;
      return `M ${cx - rx},${cy} A ${rx},${ry} 0 0,1 ${cx + rx},${cy} A ${rx},${ry} 0 0,1 ${cx - rx},${cy} Z`;
    }
    case "line": {
      const x1 = numAttr(el, "x1");
      const y1 = numAttr(el, "y1");
      const x2 = numAttr(el, "x2");
      const y2 = numAttr(el, "y2");
      return `M ${x1},${y1} L ${x2},${y2}`;
    }
    case "polyline":
    case "polygon": {
      const raw = el.getAttribute("points");
      if (!raw) return null;
      const nums = raw
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (nums.length < 4 || nums.length % 2 !== 0) return null;
      const parts: string[] = [`M ${nums[0]},${nums[1]}`];
      for (let i = 2; i < nums.length; i += 2) parts.push(`L ${nums[i]},${nums[i + 1]}`);
      if (tag === "polygon") parts.push("Z");
      return parts.join(" ");
    }
    default:
      return null;
  }
}

function numAttr(el: Element, name: string): number {
  const v = el.getAttribute(name);
  return v == null ? 0 : Number.parseFloat(v);
}

/**
 * Read a presentation attribute (fill, stroke, fill-opacity, …) honouring
 * both the direct-attribute form (`fill="red"`) and the inline-style form
 * (`style="fill:red"`). Inkscape exports default to the latter; older Fusion
 * exports to the former. CSS rules say `style` wins over presentation
 * attributes, but we accept either since they're never both set in practice.
 */
function presentationAttr(el: Element, name: string): string | null {
  const direct = el.getAttribute(name);
  if (direct != null && direct !== "") return direct;
  const style = el.getAttribute("style");
  if (!style) return null;
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    if (decl.slice(0, colon).trim() === name) {
      return decl.slice(colon + 1).trim();
    }
  }
  return null;
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
