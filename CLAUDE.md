# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal

A 3D viewer that simulates the result of cutting a Shaper Origin SVG into the
top surface of a board of given dimensions. The user specifies board size and
wood species, loads an SVG, drags it onto the board, picks a tool (default 6mm
upcut, overridable per cut), and sees the cut result rendered in 3D.

Hosted as a static web app — the user's SVG never leaves the browser.

## Repository state

Web app at the repo root (Phase 0 scaffolding). Python implementation has been
relocated to `python-reference/` and now serves as the executable spec / oracle
for the TypeScript port.

- `src/` — the web app (Vite + TypeScript + React + react-three-fiber).
- `tests/` — Vitest tests; load fixtures from `examples/` directly.
- `examples/` — Shaper Origin SVGs paired with PNG renderings; used as test
  fixtures and visual ground truth. Shared between the web app and the
  Python reference.
- `python-reference/` — the previous Phase 0–2 Python implementation. 53 pytest
  cases encoding the SVG-format rules; treat as a working oracle to diff
  against while porting.

## Dev commands (web app)

Stack: pnpm + Vite + TypeScript + React + Three.js (via react-three-fiber +
drei) + Tailwind 4 + Biome + Vitest.

- `pnpm install` — install JS deps.
- `pnpm dev` — Vite dev server with HMR.
- `pnpm build` — type-check + production bundle to `dist/`.
- `pnpm test` — Vitest run-once.
- `pnpm test:watch` — Vitest in watch mode.
- `pnpm lint` — Biome (lint + format check).
- `pnpm format` — Biome format-write.

## Dev commands (Python reference)

For diffing the TS port against known-good behaviour. Run from
`python-reference/`:

- `uv sync --extra dev` — install runtime + dev deps.
- `uv run pytest -q` — run all 53 tests.
- `uv run shaper-viewer <file.svg>` — render top-down depth PNG (handy as a
  pixel-level oracle for the eventual TS depth-field output).

## Phase plan (web)

Each phase ends with a runnable, testable artefact.

- **0. Scaffolding.** Vite + TS + React + r3f, Tailwind, Biome, Vitest, hello-
  world 3D scene with orbit controls. Smoke test reads the example SVGs from
  disk. ✓
- **1. Parser.** `src/parser/`. svg-pathdata + recursive de Casteljau flatness
  subdivision, custom transform-stack resolver. 30 Vitest cases + 12 oracle
  parity cases pinned to the Python output. ✓
- **2. Depth field.** `src/depth/`. clipper2-js for polygon offset/boolean ops.
  `cutFootprint(cut, tool)` returns the 2D removal region as a multi-polygon.
  Heightmap rasterisation skipped — phase 3 will use the polygons directly
  for ExtrudeGeometry. 17 Vitest cases. ✓
- **3. 3D viewer.** Board (BoxGeometry) minus union of cut volumes (per-cut
  ExtrudeGeometry of the depth-field footprint, depth-clamped to thickness +
  ε for through-cuts) via `three-bvh-csg`. Sidebar with example picker, board
  W/L/T inputs, wood species swatches, and tool diameter/type controls. ✓
- **4. Interactions + UI.** Drag-to-place via r3f raycasting, board size,
  species picker, tool default + per-cut overrides, mm/inch toggle.
- **5. Polish + ship.** PWA shell, IndexedDB persistence, deployment, Playwright
  smoke.

## Tool model

- Default tool: **6 mm upcut** (overridable in the UI).
- Per-cut override: the UI lets the user set diameter and tool type for any
  individual cut. The SVG's `shaper:toolDia` attribute, if present, is the
  initial value; otherwise the default applies.
- Tool *type* (upcut, downcut, compression, straight, v-bit, ball-nose) does
  not affect cut footprint geometry yet; only the diameter does. Type is
  reserved for future v-bit / ball-nose rendering.

Old colour-coded SVGs (e.g. `switch-panel.svg`) lack `shaper:toolDia` — without
the default, their inside/outside kerfs collapse to zero width and don't render.

Offset sign rule: **positive offset eats into the *kept* side** of the cut
line. Encoded once in the buffer formulas; see `python-reference/shaper_viewer/depth.py::cut_footprint` for the canonical implementation.

## Shaper Origin SVG conventions

Shaper Origin SVGs are standard SVG plus a `shaper:` namespace
(`http://www.shapertools.com/namespaces/shaper`). Cut semantics are encoded by
**fill/stroke colour**, with depth in a custom attribute. To render cuts
correctly the viewer must decode both.

### Cut type

Two encodings exist in the wild and both must be supported:

1. **Explicit `shaper:cutType` attribute** (newer, e.g. `box-base.svg`,
   `Crossover.svg`): one of `"outside"`, `"inside"`, `"pocket"`, `"online"`,
   `"guide"`, `"anchor"`. Prefer this when present.
2. **Colour-coded fill/stroke** (older Fusion/Inkscape exports, e.g.
   `switch-panel.svg`): decode using the table below. Authoritative source:
   `~/Projects/shaper-origin-inkscape/ext/shaper_origin.py` (do *not* depend
   on the Inkscape framework itself — only mirror the conventions).

| `cutType` | Stroke | Fill   | Fill-opacity | Meaning                                    |
| --------- | ------ | ------ | ------------ | ------------------------------------------ |
| `outside` | black  | black  | 1            | Bit travels outside the path               |
| `inside`  | black  | white  | 1            | Bit travels inside the path (hole)         |
| `pocket`  | white  | grey   | 1            | Material removed inside path to cut depth  |
| `online`  | grey   | white  | 0            | Bit centred on the path                    |
| `guide`   | blue   | blue   | 1            | Reference geometry, not cut                |
| `anchor`  | —      | red    | 1            | Placement reference point (see below)      |

Real-world files often use slightly off-pure greys (e.g. `rgb(170,170,170)`,
`rgb(183,183,183)` in `examples/switch-panel.svg`) — treat any mid-grey as
"grey" rather than requiring exact matches.

### Anchors

An anchor (`shaper:cutType="anchor"`, fill `#FF0000`) is a red triangle that
defines the **reference point used to place the design on the board** — it
is not cut. The viewer should use this point, when present, as the origin
for placement transforms rather than the SVG's own 0,0. See
`examples/1 inch square with anchor.svg`.

Constraints:

- **At most one anchor per file** — multiple anchors are not allowed.
- The triangle has one fixed valid orientation (the one shown in the
  example). Other orientations are not legal input; the viewer can assume
  the canonical form when locating the reference vertex.

### Cut depth and other path attributes

- `shaper:cutDepth` — length with explicit units, e.g. `"1.2cm"`,
  `"0.250 in"` (note: space allowed, `in` for inches). Parse the unit; do
  not assume mm. If `cutDepth ≥ board thickness`, render the cut as going
  **all the way through** the board.
- `shaper:cutOffset` — *signed* bit offset from the path. Sign convention:
  - **Positive (+)** moves the cutter *away* from the cut line: pockets
    (holes) become **larger**, islands (parts) become **smaller**.
  - **Negative (−)** moves the cutter *into* the material: pockets become
    **smaller**, islands become **larger**.
  - Not valid for `online` or `guide` (no defined inside/outside) — ignore
    the attribute on those types.
- `shaper:toolDia` — required bit diameter, e.g. `"0.125in"`.

### Overlap / depth resolution

When multiple cuts overlap on the same region of the board, the **deepest
cut wins** at each point — composite the depth field by taking the maximum
removal at each (x,y), not by layering. A through-cut beats every other
cut.

### Coordinate system

Two conventions appear across the example files; the parser must handle
both:

- **Fusion-style Y-flip**: `viewBox="0 0 W H"` plus a per-path
  `transform="matrix(1,0,0,-1,-0,H)"` that flips Y. Seen in
  `switch-panel.svg`, `box-base.svg`, `Crossover.svg`.
- **Negative-Y viewBox**: `viewBox="0 -H W H"` with no flip transform; group
  transforms place geometry. Seen in `1 inch square with anchor.svg`.

Always resolve the full transform stack (path + ancestor `<g>`s + viewBox)
before treating coordinates as physical positions.

The SVG `width`/`height` give the physical part size (`width="16cm"
height="11cm"` → user units == cm; `width="25.4mm"` → user units == mm).
Don't assume px.

### Other input constraints

- **Text elements** (`<text>`) are not used — text must be converted to
  paths before export. The viewer does not need to handle `<text>`.
- **Path closure**: all paths must be closed (end with `Z`/`z`) *except*
  `cutType="online"`, which may be open polylines (a centerline has no
  defined inside/outside, so an open trace is meaningful). `Crossover.svg`
  has examples of open `online` paths.

## Reference material

- `examples/*.svg` + matching `*.png` — test fixtures with expected visual output.
- `python-reference/` — working Python implementation of phases 0–2. The tests
  encode the rules executably; the renderer's PNG output is a pixel-level
  oracle for the TS port.
- `~/Projects/shaper-origin-inkscape/ext/shaper_origin.py` — canonical colour /
  attribute encoding, mirrored above. Read it if the table looks wrong.
