"""SVG → Document parser for Shaper Origin files.

Normalises both supported SVG conventions (Fusion-style Y-flip matrix and
negative-Y viewBox) into a single frame: millimetres, origin at the
document's top-left, +Y down.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path as _Path
from typing import Literal

import shapely.geometry as sg
from svgelements import (
    SVG,
    Arc,
    Close,
    Color,
    CubicBezier,
    Line,
    Move,
    QuadraticBezier,
)
from svgelements import Path as SvgPath

CutType = Literal["outside", "inside", "pocket", "online", "guide", "anchor"]

_PX_PER_MM = 96.0 / 25.4  # SVG default 96 DPI; svgelements reifies into px
_SHAPER_NS = "{http://www.shapertools.com/namespaces/shaper}"

# Curve sampling: 0.05mm chord tolerance is well under any practical cut feature.
_CURVE_CHORD_TOL_MM = 0.05


@dataclass(frozen=True)
class Cut:
    cut_type: CutType
    depth_mm: float | None  # None for guide/anchor
    offset_mm: float  # signed; 0 for online/guide/anchor
    tool_dia_mm: float | None
    geometry: sg.Polygon | sg.LineString
    closed: bool


@dataclass
class Document:
    width_mm: float
    height_mm: float
    cuts: list[Cut] = field(default_factory=list)
    anchor: sg.Point | None = None


# --------------------------------------------------------------------------- #
# Length parsing
# --------------------------------------------------------------------------- #

_UNIT_TO_MM = {
    "mm": 1.0,
    "cm": 10.0,
    "in": 25.4,
    "": 1.0,  # bare number on a shaper attribute → assume mm
}
_LENGTH_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$")


def parse_length_mm(text: str | None) -> float | None:
    if text is None:
        return None
    m = _LENGTH_RE.match(str(text))
    if not m:
        raise ValueError(f"cannot parse length: {text!r}")
    value, unit = float(m.group(1)), m.group(2).lower()
    if unit not in _UNIT_TO_MM:
        raise ValueError(f"unsupported unit {unit!r} in {text!r}")
    return value * _UNIT_TO_MM[unit]


# --------------------------------------------------------------------------- #
# Cut-type classification (colour fallback for files without shaper:cutType)
# --------------------------------------------------------------------------- #


def _color_kind(c) -> str | None:
    """Return a coarse colour bucket: black/white/grey/red/blue, or None."""
    if c is None or not isinstance(c, Color) or c.value is None:
        return None
    r, g, b = c.red, c.green, c.blue
    if r is None:
        return None
    if r >= 128 and g < 96 and b < 96:
        return "red"
    if b >= 128 and r < 96 and g < 96:
        return "blue"
    spread = max(r, g, b) - min(r, g, b)
    if spread <= 24:
        avg = (r + g + b) / 3
        if avg < 32:
            return "black"
        if avg > 224:
            return "white"
        return "grey"
    return None


def _classify_by_color(fill, stroke, fill_opacity: float) -> CutType | None:
    f = _color_kind(fill)
    s = _color_kind(stroke)

    if f == "red":
        return "anchor"
    if f == "blue":
        return "guide"
    if f == "black" and s in ("black", None):
        return "outside"
    if f == "white" and s == "black":
        return "inside"
    if f == "grey" and s in ("white", None):
        return "pocket"
    if (f == "white" and s == "grey") or (fill_opacity == 0 and s == "grey"):
        return "online"
    return None


# --------------------------------------------------------------------------- #
# Geometry extraction
# --------------------------------------------------------------------------- #


def _adaptive_steps(seg, tol_px: float) -> int:
    """Pick a sample count so the chord error stays under tol_px."""
    try:
        length = float(seg.length(error=tol_px))
    except Exception:
        length = 0.0
    return max(8, int(math.ceil(length / max(tol_px, 1e-6))))


def _subpath_coords(segments, tol_px: float) -> tuple[list[tuple[float, float]], bool]:
    """Sample one subpath into a list of (x, y) coords. Returns (coords, closed)."""
    coords: list[tuple[float, float]] = []
    closed = False
    for seg in segments:
        if isinstance(seg, (Move, Line)):
            coords.append((seg.end.x, seg.end.y))
        elif isinstance(seg, Close):
            closed = True
            if coords and coords[0] != coords[-1]:
                coords.append(coords[0])
        elif isinstance(seg, (CubicBezier, QuadraticBezier, Arc)):
            steps = _adaptive_steps(seg, tol_px)
            for i in range(1, steps + 1):
                p = seg.point(i / steps)
                coords.append((p.x, p.y))
        else:
            raise ValueError(f"unsupported segment type: {type(seg).__name__}")
    return coords, closed


def _path_to_geometry(
    path: SvgPath, tol_px: float
) -> tuple[sg.Polygon | sg.MultiPolygon | sg.LineString, bool]:
    """Convert an svgelements Path into a shapely geometry. Returns (geom, all_closed)."""
    subpaths = list(path.as_subpaths())
    if not subpaths:
        raise ValueError("empty path")

    rings: list[tuple[list[tuple[float, float]], bool]] = []
    for sp in subpaths:
        coords, closed = _subpath_coords(list(sp), tol_px)
        if len(coords) < 2:
            continue
        rings.append((coords, closed))

    if not rings:
        raise ValueError("no usable geometry in path")

    all_closed = all(closed for _, closed in rings)

    if all_closed:
        if len(rings) == 1:
            return sg.Polygon(rings[0][0]), True
        # Multiple closed rings — treat the largest by area as outer, rest as holes
        # (Shaper files in practice don't seem to need true even-odd handling at
        # phase-1 fidelity; revisit if a real fixture breaks this assumption.)
        polys = [sg.Polygon(c) for c, _ in rings]
        polys.sort(key=lambda p: p.area, reverse=True)
        outer = polys[0]
        return sg.Polygon(outer.exterior.coords, [p.exterior.coords for p in polys[1:]]), True

    if len(rings) == 1:
        return sg.LineString(rings[0][0]), False
    raise ValueError("multi-subpath open paths are not supported")


# --------------------------------------------------------------------------- #
# Anchor handling
# --------------------------------------------------------------------------- #


def _right_angle_vertex(poly: sg.Polygon) -> sg.Point:
    """Find the right-angle vertex of an anchor triangle.

    The anchor is a right triangle with one canonical orientation; we don't
    need to detect orientation, only locate the corner where the two legs
    meet (the vertex with the largest interior angle deviation from acute).
    """
    coords = list(poly.exterior.coords)[:-1]
    if len(coords) != 3:
        raise ValueError(f"anchor must be a triangle, got {len(coords)} vertices")
    best_idx, best_dot = 0, 1.0  # cos(angle); smallest |cos| → closest to 90°
    for i in range(3):
        a = coords[(i - 1) % 3]
        b = coords[i]
        c = coords[(i + 1) % 3]
        v1 = (a[0] - b[0], a[1] - b[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        n1 = math.hypot(*v1) or 1.0
        n2 = math.hypot(*v2) or 1.0
        cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
        if abs(cos) < abs(best_dot):
            best_dot, best_idx = cos, i
    bx, by = coords[best_idx]
    return sg.Point(bx, by)


# --------------------------------------------------------------------------- #
# Main entry
# --------------------------------------------------------------------------- #


def parse_svg(path: str | _Path) -> Document:
    svg = SVG.parse(str(path), reify=True, ppi=96)
    width_mm = float(svg.width) / _PX_PER_MM
    height_mm = float(svg.height) / _PX_PER_MM
    tol_px = _CURVE_CHORD_TOL_MM * _PX_PER_MM

    cuts: list[Cut] = []
    anchor_point: sg.Point | None = None

    for elem in svg.elements():
        if not isinstance(elem, SvgPath):
            continue

        # Read shaper attributes
        cut_type_raw = elem.values.get(f"{_SHAPER_NS}cutType")
        depth_raw = elem.values.get(f"{_SHAPER_NS}cutDepth")
        offset_raw = elem.values.get(f"{_SHAPER_NS}cutOffset")
        tooldia_raw = elem.values.get(f"{_SHAPER_NS}toolDia")

        # Determine cut type: explicit attribute first, then colour heuristic.
        if cut_type_raw in ("outside", "inside", "pocket", "online", "guide", "anchor"):
            cut_type: CutType = cut_type_raw  # type: ignore[assignment]
        else:
            fill_opacity = float(elem.values.get("fill-opacity", 1) or 0)
            cut_type_guess = _classify_by_color(elem.fill, elem.stroke, fill_opacity)
            if cut_type_guess is None:
                continue  # not a recognised shaper element; skip
            cut_type = cut_type_guess

        # Build geometry in pixel space, then convert to mm.
        geom_px, closed = _path_to_geometry(elem, tol_px)
        geom_mm = _scale_geometry(geom_px, 1.0 / _PX_PER_MM)

        # Closure rule: only `online` may be open.
        if not closed and cut_type != "online":
            raise ValueError(
                f"non-online cut ({cut_type}) has an open path — not allowed by spec"
            )

        if cut_type == "anchor":
            if anchor_point is not None:
                raise ValueError("multiple anchors are not allowed")
            if not isinstance(geom_mm, sg.Polygon):
                raise ValueError("anchor must be a closed polygon")
            anchor_point = _right_angle_vertex(geom_mm)
            continue

        depth_mm = parse_length_mm(depth_raw) if cut_type not in ("guide",) else None
        offset_mm = parse_length_mm(offset_raw) or 0.0
        if cut_type in ("online", "guide"):
            offset_mm = 0.0  # not applicable; spec says ignore
        tool_dia_mm = parse_length_mm(tooldia_raw)

        cuts.append(
            Cut(
                cut_type=cut_type,
                depth_mm=depth_mm,
                offset_mm=offset_mm,
                tool_dia_mm=tool_dia_mm,
                geometry=geom_mm,
                closed=closed,
            )
        )

    return Document(width_mm=width_mm, height_mm=height_mm, cuts=cuts, anchor=anchor_point)


def _scale_geometry(geom, scale: float):
    """Uniform scale of a shapely geometry around the origin."""
    if isinstance(geom, sg.Polygon):
        ext = [(x * scale, y * scale) for x, y in geom.exterior.coords]
        ints = [
            [(x * scale, y * scale) for x, y in ring.coords] for ring in geom.interiors
        ]
        return sg.Polygon(ext, ints)
    if isinstance(geom, sg.MultiPolygon):
        return sg.MultiPolygon([_scale_geometry(p, scale) for p in geom.geoms])
    if isinstance(geom, sg.LineString):
        return sg.LineString([(x * scale, y * scale) for x, y in geom.coords])
    raise TypeError(f"cannot scale {type(geom).__name__}")
