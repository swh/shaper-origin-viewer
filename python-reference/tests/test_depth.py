from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import shapely.geometry as sg

from shaper_viewer.depth import (
    cut_footprint,
    depth_to_image,
    render_depth,
)
from shaper_viewer.parser import Cut, Document, parse_svg

# --------------------------------------------------------------------------- #
# Helpers: synthesise minimal Cut/Document fixtures for unit-level tests.
# --------------------------------------------------------------------------- #


def _square_cut(
    cut_type: str,
    *,
    side: float = 20.0,
    depth: float = 5.0,
    offset: float = 0.0,
    tool_dia: float = 3.0,
    centred_at: tuple[float, float] = (50.0, 50.0),
) -> Cut:
    cx, cy = centred_at
    h = side / 2.0
    poly = sg.Polygon(
        [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)]
    )
    return Cut(
        cut_type=cut_type,  # type: ignore[arg-type]
        depth_mm=depth,
        offset_mm=offset,
        tool_dia_mm=tool_dia,
        geometry=poly,
        closed=True,
    )


def _doc(*cuts: Cut, w: float = 100.0, h: float = 100.0) -> Document:
    return Document(width_mm=w, height_mm=h, cuts=list(cuts))


# --------------------------------------------------------------------------- #
# Footprint shapes per cut type
# --------------------------------------------------------------------------- #


def test_pocket_footprint_is_polygon_itself_when_offset_zero() -> None:
    cut = _square_cut("pocket", side=20.0, offset=0.0, tool_dia=3.0)
    fp = cut_footprint(cut)
    assert fp.area == pytest.approx(cut.geometry.area, rel=1e-9)


def test_pocket_positive_offset_grows_hole() -> None:
    base = _square_cut("pocket", side=20.0, offset=0.0)
    plus = _square_cut("pocket", side=20.0, offset=+1.0)
    minus = _square_cut("pocket", side=20.0, offset=-1.0)
    assert cut_footprint(plus).area > cut_footprint(base).area
    assert cut_footprint(minus).area < cut_footprint(base).area


def test_inside_kerf_is_annulus_inside_polygon_at_zero_offset() -> None:
    cut = _square_cut("inside", side=20.0, offset=0.0, tool_dia=3.0)
    fp = cut_footprint(cut)
    # Kerf width = toolDia (3mm), so inner hole shrinks by 3 on each side: (20-6)² = 196.
    # Kerf area = 400 - 196 = 204 mm² (corner rounding negligible for inside-buffer).
    assert fp.area == pytest.approx(20 * 20 - 14 * 14, rel=0.02)
    # Footprint must lie *inside* the polygon (it's an inside cut).
    assert cut.geometry.buffer(1e-6).contains(fp)


def test_inside_positive_offset_grows_hole() -> None:
    base = _square_cut("inside", side=20.0, offset=0.0, tool_dia=3.0)
    plus = _square_cut("inside", side=20.0, offset=+1.0, tool_dia=3.0)
    # The "hole" is the outer envelope of the kerf, not the kerf area itself.
    assert cut_footprint(plus).convex_hull.area > cut_footprint(base).convex_hull.area


def test_outside_kerf_is_annulus_outside_polygon_at_zero_offset() -> None:
    cut = _square_cut("outside", side=20.0, offset=0.0, tool_dia=3.0)
    fp = cut_footprint(cut)
    # Kerf width = toolDia (3mm) on the outside; outer envelope is polygon.buffer(+3).
    # 26×26 outer (sides) minus rounded corners minus 20×20 inner ≈ 268 mm².
    # Use a permissive band around the rounded-corner approximation.
    assert 250 < fp.area < 290
    # Polygon interior must be untouched (kept side).
    assert cut.geometry.buffer(-1e-6).disjoint(fp)


def test_outside_positive_offset_shrinks_island() -> None:
    """+offset on an outside cut eats inward into the part."""
    base = _square_cut("outside", side=20.0, offset=0.0, tool_dia=3.0)
    plus = _square_cut("outside", side=20.0, offset=+1.0, tool_dia=3.0)
    base_inner = base.geometry.difference(cut_footprint(base))  # remaining island
    plus_inner = plus.geometry.difference(cut_footprint(plus))
    assert plus_inner.area < base_inner.area


def test_online_footprint_is_stadium_around_path() -> None:
    line = sg.LineString([(10, 10), (50, 10)])
    cut = Cut(
        cut_type="online",
        depth_mm=2.0,
        offset_mm=0.0,
        tool_dia_mm=4.0,
        geometry=line,
        closed=False,
    )
    fp = cut_footprint(cut)
    # A 40mm line × 4mm wide ≈ 160 mm² + two semicircular caps (π·2² = ~12.57).
    assert fp.area == pytest.approx(40 * 4 + 3.14159 * 2**2, rel=0.05)


# --------------------------------------------------------------------------- #
# Depth-field composition rules
# --------------------------------------------------------------------------- #


def test_through_cut_when_depth_meets_thickness() -> None:
    cut = _square_cut("pocket", side=20.0, depth=12.0)
    field = render_depth(_doc(cut), board_thickness_mm=12.0, mm_per_pixel=0.5)
    # Centre of the square is well inside the pocket; expect a through-cut there.
    cy = int(field.depth_mm.shape[0] * 0.5)
    cx = int(field.depth_mm.shape[1] * 0.5)
    assert field.holes_mask[cy, cx]
    # Outside the pocket: no removal, no hole.
    assert field.depth_mm[2, 2] == 0.0
    assert not field.holes_mask[2, 2]


def test_partial_cut_does_not_punch_through() -> None:
    cut = _square_cut("pocket", side=20.0, depth=3.0)
    field = render_depth(_doc(cut), board_thickness_mm=12.0, mm_per_pixel=0.5)
    cy, cx = (s // 2 for s in field.depth_mm.shape)
    assert field.depth_mm[cy, cx] == pytest.approx(3.0)
    assert not field.holes_mask.any()


def test_deepest_cut_wins_when_overlapping() -> None:
    shallow = _square_cut("pocket", side=20.0, depth=2.0)
    deep = _square_cut("pocket", side=10.0, depth=8.0)  # nested inside the shallow one
    field = render_depth(_doc(shallow, deep), board_thickness_mm=12.0, mm_per_pixel=0.5)
    cy, cx = (s // 2 for s in field.depth_mm.shape)
    # Centre is inside both; the deep cut must win.
    assert field.depth_mm[cy, cx] == pytest.approx(8.0)
    # A point inside only the shallow cut should still see only the shallow depth.
    px_per_mm = 1 / field.mm_per_pixel
    assert field.depth_mm[int(50 * px_per_mm), int(58 * px_per_mm)] == pytest.approx(2.0)


def test_depth_clamped_to_board_thickness() -> None:
    cut = _square_cut("pocket", side=20.0, depth=20.0)
    field = render_depth(_doc(cut), board_thickness_mm=12.0, mm_per_pixel=0.5)
    assert field.depth_mm.max() <= 12.0
    assert field.holes_mask.any()


def test_guide_and_anchor_do_not_remove_material() -> None:
    guide = replace(_square_cut("pocket", depth=5.0), cut_type="guide", depth_mm=None)
    field = render_depth(_doc(guide), board_thickness_mm=12.0, mm_per_pixel=0.5)
    assert field.depth_mm.max() == 0.0


# --------------------------------------------------------------------------- #
# End-to-end: render every example to a depth field
# --------------------------------------------------------------------------- #


def test_anchor_square_renders_through_hole(examples_dir: Path) -> None:
    """0.250in (6.35mm) pocket on a 6mm board → through-hole over the whole part."""
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    field = render_depth(doc, board_thickness_mm=6.0, mm_per_pixel=0.2)
    assert field.holes_mask.sum() / field.holes_mask.size > 0.95


def test_anchor_square_renders_partial_pocket(examples_dir: Path) -> None:
    """Same cut on a thicker board → 6.35mm pocket, no through-hole."""
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    field = render_depth(doc, board_thickness_mm=12.0, mm_per_pixel=0.2)
    assert not field.holes_mask.any()
    assert field.depth_mm.max() == pytest.approx(6.35, abs=1e-3)


def test_every_example_renders_without_error(example_svg: Path) -> None:
    doc = parse_svg(example_svg)
    field = render_depth(doc, board_thickness_mm=12.0)
    assert field.depth_mm.shape == field.holes_mask.shape
    assert np.isfinite(field.depth_mm).all()
    img = depth_to_image(field)
    # Image must match field shape (W, H in PIL is reversed from numpy axes).
    assert img.size == (field.depth_mm.shape[1], field.depth_mm.shape[0])
