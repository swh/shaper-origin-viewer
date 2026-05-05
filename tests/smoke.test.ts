import { describe, expect, test } from "vitest";
import { ALL_EXAMPLES, readExample } from "./fixtures";

describe.each(ALL_EXAMPLES)("example %s", (name) => {
  test("is readable and looks like an SVG", () => {
    const text = readExample(name);
    expect(text.trimStart().startsWith("<")).toBe(true);
    expect(text).toMatch(/<svg\b/);
  });
});
