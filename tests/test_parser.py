from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import pytest

from shaper_viewer.parser import (
    Cut,
    Document,
    parse_length_mm,
    parse_svg,
)

# --------------------------------------------------------------------------- #
# Length parsing
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "text, expected",
    [
        ("1.2cm", 12.0),
        ("3mm", 3.0),
        ("0.250 in", 6.35),
        ("0in", 0.0),
        ("0.125in", 3.175),
        ("25.4mm", 25.4),
        ("5", 5.0),  # bare number → mm
    ],
)
def test_parse_length_mm(text: str, expected: float) -> None:
    assert parse_length_mm(text) == pytest.approx(expected, abs=1e-9)


def test_parse_length_mm_none() -> None:
    assert parse_length_mm(None) is None


# --------------------------------------------------------------------------- #
# Document-level metadata
# --------------------------------------------------------------------------- #


def test_anchor_square_dimensions(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    assert doc.width_mm == pytest.approx(25.4, abs=1e-3)
    assert doc.height_mm == pytest.approx(25.4, abs=1e-3)


def test_switch_panel_dimensions(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "switch-panel.svg")
    assert doc.width_mm == pytest.approx(160.0, abs=1e-2)
    assert doc.height_mm == pytest.approx(110.0, abs=1e-2)


# --------------------------------------------------------------------------- #
# Anchor extraction
# --------------------------------------------------------------------------- #


def test_anchor_extracted_at_bottom_left(examples_dir: Path) -> None:
    """The example's right-angle vertex is at the document's bottom-left corner."""
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    assert doc.anchor is not None
    # Bottom-left in our top-left-origin, +Y down convention is (0, height).
    assert doc.anchor.x == pytest.approx(0.0, abs=1e-3)
    assert doc.anchor.y == pytest.approx(25.4, abs=1e-3)


def test_anchor_not_in_cut_list(examples_dir: Path) -> None:
    """Anchors are reference geometry, not cuts — they must not appear in cuts."""
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    assert all(c.cut_type != "anchor" for c in doc.cuts)


# --------------------------------------------------------------------------- #
# Cut counts and types
# --------------------------------------------------------------------------- #


def _type_counts(doc: Document) -> dict[str, int]:
    return dict(Counter(c.cut_type for c in doc.cuts))


def test_anchor_square_cuts(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    assert _type_counts(doc) == {"pocket": 1}


def test_box_base_has_only_known_types(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "box-base.svg")
    counts = _type_counts(doc)
    assert set(counts) <= {"outside", "inside", "pocket", "online", "guide"}
    assert sum(counts.values()) > 0


def test_crossover_covers_all_explicit_cut_types(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "Crossover.svg")
    counts = _type_counts(doc)
    # Crossover.svg is the file with the widest cutType vocabulary.
    for t in ("outside", "inside", "pocket", "online", "guide"):
        assert counts.get(t, 0) > 0, f"expected at least one {t} cut"


def test_switch_panel_uses_color_fallback(examples_dir: Path) -> None:
    """switch-panel.svg has no shaper:cutType attrs — the colour fallback must classify them."""
    doc = parse_svg(examples_dir / "switch-panel.svg")
    counts = _type_counts(doc)
    assert sum(counts.values()) > 0
    assert set(counts) <= {"outside", "inside", "pocket", "online", "guide"}


# --------------------------------------------------------------------------- #
# Cut attributes round-trip in mm
# --------------------------------------------------------------------------- #


def test_anchor_square_pocket_attributes(examples_dir: Path) -> None:
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    pocket = next(c for c in doc.cuts if c.cut_type == "pocket")
    assert pocket.depth_mm == pytest.approx(6.35, abs=1e-3)  # 0.250 in
    assert pocket.tool_dia_mm == pytest.approx(3.175, abs=1e-3)  # 0.125 in
    assert pocket.offset_mm == pytest.approx(0.0, abs=1e-9)
    assert pocket.closed is True


def test_pocket_geometry_covers_board(examples_dir: Path) -> None:
    """The pocket in the anchor example covers the full 25.4×25.4mm board."""
    doc = parse_svg(examples_dir / "1 inch square with anchor.svg")
    pocket = next(c for c in doc.cuts if c.cut_type == "pocket")
    minx, miny, maxx, maxy = pocket.geometry.bounds
    assert minx == pytest.approx(0.0, abs=1e-3)
    assert miny == pytest.approx(0.0, abs=1e-3)
    assert maxx == pytest.approx(25.4, abs=1e-3)
    assert maxy == pytest.approx(25.4, abs=1e-3)


# --------------------------------------------------------------------------- #
# Closure rule
# --------------------------------------------------------------------------- #


def test_only_online_cuts_may_be_open(example_svg: Path) -> None:
    doc = parse_svg(example_svg)
    for c in doc.cuts:
        if not c.closed:
            assert c.cut_type == "online", (
                f"open path of type {c.cut_type} found in {example_svg.name}"
            )


def test_crossover_has_open_online_cuts(examples_dir: Path) -> None:
    """Crossover.svg is the canonical example of open online polylines."""
    doc = parse_svg(examples_dir / "Crossover.svg")
    open_online = [c for c in doc.cuts if c.cut_type == "online" and not c.closed]
    assert len(open_online) > 0


# --------------------------------------------------------------------------- #
# Geometry sanity
# --------------------------------------------------------------------------- #


def test_all_geometries_inside_document_bounds(example_svg: Path) -> None:
    doc = parse_svg(example_svg)
    # Allow a tiny epsilon for rounding from the px↔mm round trip.
    eps = 0.05
    for c in doc.cuts:
        minx, miny, maxx, maxy = c.geometry.bounds
        assert minx >= -eps
        assert miny >= -eps
        assert maxx <= doc.width_mm + eps
        assert maxy <= doc.height_mm + eps, (
            f"{c.cut_type} extends past board: bounds={c.geometry.bounds} "
            f"doc={doc.width_mm}×{doc.height_mm}"
        )
    if doc.anchor is not None:
        assert -eps <= doc.anchor.x <= doc.width_mm + eps
        assert -eps <= doc.anchor.y <= doc.height_mm + eps


def test_finite_coordinates(example_svg: Path) -> None:
    doc = parse_svg(example_svg)
    for c in doc.cuts:
        for x, y in _all_coords(c):
            assert math.isfinite(x) and math.isfinite(y)


def _all_coords(cut: Cut):
    geom = cut.geometry
    if hasattr(geom, "exterior"):
        yield from geom.exterior.coords
        for ring in geom.interiors:
            yield from ring.coords
    elif hasattr(geom, "coords"):
        yield from geom.coords
