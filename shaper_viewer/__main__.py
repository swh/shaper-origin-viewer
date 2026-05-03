"""CLI entry point.

Phase 2: parse SVG → render top-down depth-as-grayscale PNG.
The 3D viewer lands in phase 3.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from shaper_viewer.depth import depth_to_image, render_depth
from shaper_viewer.parser import parse_svg


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="shaper-viewer", description=__doc__)
    parser.add_argument("svg", type=Path, help="Shaper Origin SVG file")
    parser.add_argument(
        "-t",
        "--thickness",
        type=float,
        default=12.0,
        help="board thickness in mm (default: 12.0)",
    )
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        help="output PNG path (default: <svg>.depth.png)",
    )
    parser.add_argument(
        "--pitch",
        type=float,
        default=None,
        help="raster pitch in mm/pixel (default: auto, ~0.1mm)",
    )
    args = parser.parse_args(argv)

    doc = parse_svg(args.svg)
    field = render_depth(
        doc, board_thickness_mm=args.thickness, mm_per_pixel=args.pitch
    )
    out = args.out or args.svg.with_suffix(".depth.png")
    depth_to_image(field).save(out)
    print(
        f"{args.svg.name}: {doc.width_mm:.1f}×{doc.height_mm:.1f}mm, "
        f"{len(doc.cuts)} cuts, "
        f"{field.holes_mask.sum() / field.holes_mask.size:.1%} through, "
        f"→ {out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
