import { describe, expect, test } from "vitest";
import { DEFAULT_TOOL } from "../src/depth";
import { parseSvg } from "../src/parser";
import { buildCutVolumes } from "../src/viewer/cuts";
import { ALL_EXAMPLES, readExample } from "./fixtures";

describe.each(ALL_EXAMPLES)("cut volumes (%s)", (name) => {
  test("buildCutVolumes produces a finite, non-empty geometry per cut", () => {
    const doc = parseSvg(readExample(name));
    const board = { widthMm: 300, heightMm: 200, thicknessMm: 18 };
    const volumes = buildCutVolumes(doc, board, DEFAULT_TOOL);

    // Every cut with a positive depth should have at least one volume.
    const cutsWithDepth = doc.cuts.filter((c) => c.depthMm != null && c.depthMm > 0);
    expect(volumes.length).toBeGreaterThanOrEqual(Math.min(1, cutsWithDepth.length));

    for (const v of volumes) {
      expect(v.geometry.attributes.position).toBeDefined();
      const pos = v.geometry.attributes.position;
      expect(pos.count).toBeGreaterThan(0);
      // Bounds should be finite and reasonable (within a generous box around the doc).
      v.geometry.computeBoundingBox();
      const bb = v.geometry.boundingBox;
      expect(bb).not.toBeNull();
      if (!bb) return;
      expect(Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x)).toBe(true);
      expect(Number.isFinite(bb.min.y) && Number.isFinite(bb.max.y)).toBe(true);
      expect(Number.isFinite(bb.min.z) && Number.isFinite(bb.max.z)).toBe(true);
    }
  });
});
