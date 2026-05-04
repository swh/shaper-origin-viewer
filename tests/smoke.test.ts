import { describe, expect, test } from "vitest";
import { ALL_EXAMPLES, readExample } from "./fixtures";

describe.each(ALL_EXAMPLES)("example %s", (name) => {
  test("is readable and uses the shaper namespace", () => {
    const text = readExample(name);
    expect(text.trimStart().startsWith("<")).toBe(true);
    expect(text).toContain("shapertools.com/namespaces/shaper");
  });
});
