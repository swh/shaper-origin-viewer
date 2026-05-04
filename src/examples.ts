// Vite imports the example SVGs as raw strings at build time so we can ship
// them with the bundle for the demo selector. Phase 4 will add a real file
// picker; users will load their own SVGs from disk via the File API.

const rawExamples = import.meta.glob("../examples/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type ExampleEntry = { id: string; label: string; text: string };

export const EXAMPLES: ExampleEntry[] = Object.entries(rawExamples)
  .map(([path, text]) => {
    const name = path.split("/").pop() ?? path;
    return { id: name, label: name.replace(/\.svg$/, ""), text };
  })
  .sort((a, b) => a.label.localeCompare(b.label));
