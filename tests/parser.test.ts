import { describe, expect, test } from "vitest";
import type { Cut, Doc } from "../src/parser";
import { parseLengthMm, parseSvg } from "../src/parser";
import { ALL_EXAMPLES, readExample } from "./fixtures";

// Convenience: parse once per fixture.
const docs: Record<string, Doc> = Object.fromEntries(
  ALL_EXAMPLES.map((name) => [name, parseSvg(readExample(name))]),
);

// --------------------------------------------------------------------------- #
// Length parsing
// --------------------------------------------------------------------------- #

describe("parseLengthMm", () => {
  test.each([
    ["1.2cm", 12],
    ["3mm", 3],
    ["0.250 in", 6.35],
    ["0in", 0],
    ["0.125in", 3.175],
    ["25.4mm", 25.4],
    ["5", 5],
  ])("%s → %fmm", (text, expected) => {
    expect(parseLengthMm(text)).toBeCloseTo(expected, 9);
  });

  test("null is null", () => {
    expect(parseLengthMm(null)).toBeNull();
    expect(parseLengthMm(undefined)).toBeNull();
  });
});

// --------------------------------------------------------------------------- #
// Document-level metadata
// --------------------------------------------------------------------------- #

describe("document dimensions", () => {
  test("anchor square is 25.4×25.4mm", () => {
    expect(docs.anchor_square.widthMm).toBeCloseTo(25.4, 3);
    expect(docs.anchor_square.heightMm).toBeCloseTo(25.4, 3);
  });

  test("switch panel is 160×110mm", () => {
    expect(docs.switch_panel.widthMm).toBeCloseTo(160, 2);
    expect(docs.switch_panel.heightMm).toBeCloseTo(110, 2);
  });
});

// --------------------------------------------------------------------------- #
// Anchor extraction
// --------------------------------------------------------------------------- #

describe("anchor extraction", () => {
  test("right-angle vertex lands at the bottom-left corner", () => {
    const a = docs.anchor_square.anchor;
    expect(a).not.toBeNull();
    if (!a) return;
    // Bottom-left in our top-left-origin, +Y down convention is (0, height).
    expect(a[0]).toBeCloseTo(0, 3);
    expect(a[1]).toBeCloseTo(25.4, 3);
  });

  test("anchors don't appear in the cut list", () => {
    expect(docs.anchor_square.cuts.every((c) => c.cutType !== "anchor")).toBe(true);
  });
});

// --------------------------------------------------------------------------- #
// Cut counts and types
// --------------------------------------------------------------------------- #

function typeCounts(doc: Doc): Record<string, number> {
  const c: Record<string, number> = {};
  for (const cut of doc.cuts) c[cut.cutType] = (c[cut.cutType] ?? 0) + 1;
  return c;
}

describe("cut counts", () => {
  test("anchor square has exactly one pocket", () => {
    expect(typeCounts(docs.anchor_square)).toEqual({ pocket: 1 });
  });

  test("box-base only contains known cut types", () => {
    const counts = typeCounts(docs.box_base);
    for (const t of Object.keys(counts)) {
      expect(["outside", "inside", "pocket", "online", "guide"]).toContain(t);
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  test("Crossover has at least one of every explicit cut type", () => {
    const counts = typeCounts(docs.crossover);
    for (const t of ["outside", "inside", "pocket", "online", "guide"]) {
      expect(counts[t] ?? 0).toBeGreaterThan(0);
    }
  });

  test("switch-panel uses the colour fallback successfully", () => {
    const counts = typeCounts(docs.switch_panel);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    for (const t of Object.keys(counts)) {
      expect(["outside", "inside", "pocket", "online", "guide"]).toContain(t);
    }
  });
});

// --------------------------------------------------------------------------- #
// Cut attributes round-trip in mm
// --------------------------------------------------------------------------- #

function findPocket(doc: Doc): Cut {
  const p = doc.cuts.find((c) => c.cutType === "pocket");
  if (!p) throw new Error("no pocket cut found");
  return p;
}

describe("anchor square pocket attributes", () => {
  test("depth is 0.250in = 6.35mm", () => {
    expect(findPocket(docs.anchor_square).depthMm).toBeCloseTo(6.35, 3);
  });
  test("tool diameter is 0.125in = 3.175mm", () => {
    expect(findPocket(docs.anchor_square).toolDiaMm).toBeCloseTo(3.175, 3);
  });
  test("offset is zero", () => {
    expect(findPocket(docs.anchor_square).offsetMm).toBeCloseTo(0, 9);
  });
  test("path is closed", () => {
    expect(findPocket(docs.anchor_square).closed).toBe(true);
  });
});

test("anchor square pocket covers the full board", () => {
  const pocket = findPocket(docs.anchor_square);
  expect(pocket.geometry.kind).toBe("polygon");
  if (pocket.geometry.kind !== "polygon") return;
  const ring = pocket.geometry.rings[0];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  expect(minX).toBeCloseTo(0, 3);
  expect(minY).toBeCloseTo(0, 3);
  expect(maxX).toBeCloseTo(25.4, 3);
  expect(maxY).toBeCloseTo(25.4, 3);
});

// --------------------------------------------------------------------------- #
// Closure rule
// --------------------------------------------------------------------------- #

describe.each(ALL_EXAMPLES)("closure rule (%s)", (name) => {
  test("only online cuts may be open", () => {
    for (const c of docs[name].cuts) {
      if (!c.closed) {
        expect(c.cutType).toBe("online");
      }
    }
  });
});

test("Crossover has open online cuts", () => {
  const open = docs.crossover.cuts.filter((c) => c.cutType === "online" && !c.closed);
  expect(open.length).toBeGreaterThan(0);
});

// --------------------------------------------------------------------------- #
// Geometry sanity
// --------------------------------------------------------------------------- #

function* allCoords(cut: Cut) {
  const g = cut.geometry;
  if (g.kind === "polygon") {
    for (const ring of g.rings) yield* ring;
  } else {
    yield* g.points;
  }
}

describe.each(ALL_EXAMPLES)("geometry bounds (%s)", (name) => {
  test("everything is inside the document and finite", () => {
    const doc = docs[name];
    const eps = 0.05;
    for (const c of doc.cuts) {
      for (const [x, y] of allCoords(c)) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-eps);
        expect(y).toBeGreaterThanOrEqual(-eps);
        expect(x).toBeLessThanOrEqual(doc.widthMm + eps);
        expect(y).toBeLessThanOrEqual(doc.heightMm + eps);
      }
    }
    if (doc.anchor) {
      const [x, y] = doc.anchor;
      expect(x).toBeGreaterThanOrEqual(-eps);
      expect(y).toBeGreaterThanOrEqual(-eps);
      expect(x).toBeLessThanOrEqual(doc.widthMm + eps);
      expect(y).toBeLessThanOrEqual(doc.heightMm + eps);
    }
  });
});
