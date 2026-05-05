import { describe, expect, test } from "vitest";
import { parseSvg } from "../src/parser";
import { ALL_EXAMPLES, readExample } from "./fixtures";

// Hard-coded oracle values produced by python-reference/. The TS parser must match.
const ORACLE = {
  anchor_square: {
    widthMm: 25.4,
    heightMm: 25.4,
    anchor: [0, 25.4] as const,
    counts: { pocket: 1 },
  },
  box_base: {
    widthMm: 150,
    heightMm: 93,
    anchor: null,
    counts: { outside: 2, pocket: 1, inside: 1 },
  },
  crossover: {
    widthMm: 210,
    heightMm: 180,
    anchor: null,
    counts: { outside: 2, guide: 7, inside: 14, pocket: 12, online: 13 },
  },
  switch_panel: {
    widthMm: 160,
    heightMm: 110,
    anchor: null,
    counts: { outside: 1, pocket: 7, inside: 6 },
  },
  // Plain Inkscape line drawing — no shaper namespace, no fill, black strokes.
  // The parser's fallback path classifies all 138 strokes as `online`.
  cnc_precision_test: {
    widthMm: 152.4,
    heightMm: 152.4,
    anchor: null,
    counts: { online: 138 },
  },
} as const;

describe.each(ALL_EXAMPLES)("oracle parity (%s)", (name) => {
  const oracle = ORACLE[name];
  const doc = parseSvg(readExample(name));

  test("dimensions match Python", () => {
    expect(doc.widthMm).toBeCloseTo(oracle.widthMm, 2);
    expect(doc.heightMm).toBeCloseTo(oracle.heightMm, 2);
  });

  test("anchor matches Python", () => {
    if (oracle.anchor === null) {
      expect(doc.anchor).toBeNull();
    } else {
      expect(doc.anchor).not.toBeNull();
      if (doc.anchor) {
        expect(doc.anchor[0]).toBeCloseTo(oracle.anchor[0], 3);
        expect(doc.anchor[1]).toBeCloseTo(oracle.anchor[1], 3);
      }
    }
  });

  test("cut-type counts match Python", () => {
    const counts: Record<string, number> = {};
    for (const c of doc.cuts) counts[c.cutType] = (counts[c.cutType] ?? 0) + 1;
    expect(counts).toEqual(oracle.counts);
  });
});
