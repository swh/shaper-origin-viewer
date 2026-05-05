import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXAMPLES_DIR = join(__dirname, "..", "examples");

export const EXAMPLE_FILES = {
  switch_panel: "switch-panel.svg",
  box_base: "box-base.svg",
  crossover: "Crossover.svg",
  anchor_square: "1 inch square with anchor.svg",
  cnc_precision_test: "CNC_Precision_Test.svg",
} as const;

export type ExampleName = keyof typeof EXAMPLE_FILES;

export function examplePath(name: ExampleName): string {
  return join(EXAMPLES_DIR, EXAMPLE_FILES[name]);
}

export function readExample(name: ExampleName): string {
  return readFileSync(examplePath(name), "utf-8");
}

export const ALL_EXAMPLES = Object.keys(EXAMPLE_FILES) as ExampleName[];
