# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal

A 3D viewer that simulates the result of cutting a Shaper Origin SVG into the
top surface of a board of given dimensions. The user specifies board size (mm
or inches), loads an SVG, places it on the board, and sees the cut result
rendered in 3D.

For GUI/rendering, prefer the Python bindings of nanogui
(https://github.com/mitsuba-renderer/nanogui) unless something clearly better
is found.

## Repository state

Phase 0 scaffolding is in place. The viewer itself is not yet implemented.

- `shaper_viewer/` — package; `parser.py` is a stub for phase 1.
- `tests/` — `pytest` fixtures expose each `examples/*.svg` to tests.
- `examples/` — Shaper Origin SVGs paired with PNG renderings showing
  approximately what a cut should look like; used as test fixtures and
  visual ground truth.

## Dev commands

Project uses `uv`. Python ≥ 3.10.

- `uv sync --extra dev` — install runtime + dev deps (svgelements, shapely,
  numpy, pillow, pytest, ruff).
- `uv run pytest -q` — run tests.
- `uv run pytest tests/test_smoke.py::test_example_readable -q` — run a
  single test.
- `uv run ruff check .` — lint.
- `uv run shaper-viewer <file.svg>` — CLI entry point (stub until phase 3).

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
- `~/Projects/shaper-origin-inkscape/ext/shaper_origin.py` — canonical colour /
  attribute encoding, mirrored above. Read it if the table looks wrong.
