"""Depth-field rasteriser for a parsed `Document`.

For each cut, build a 2D shapely "removal footprint" (where material disappears
from the top surface) using the per-cut-type rules below, then rasterise into a
heightmap. Composite is by `np.maximum` — deepest cut wins.

Offset sign convention (from the SVG spec, encoded once here):

    positive offset = cutter moves into the *kept* material → cut grows.
    negative offset = cutter retreats from the kept side → cut shrinks.

so the side that grows depends on the cut type:

    pocket    kept = outside polygon → +o expands the polygon outward
    inside    kept = outside polygon → +o expands the kerf outward
    outside   kept = inside polygon  → +o eats the kerf inward into the part
    online    no kept side defined   → offset must be 0 (parser enforces)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import shapely.geometry as sg
from PIL import Image, ImageDraw

from shaper_viewer.parser import Cut, Document

# Default raster resolution; phase 2 ships one pitch and revisits if 3D needs finer.
DEFAULT_MM_PER_PX = 0.1
MAX_PIXELS = 16_000_000  # safety cap; auto-coarsen if a board would exceed this

# Old colour-coded SVGs (e.g. switch-panel.svg) lack shaper:toolDia. 1/8" is
# Shaper Origin's default bit and matches the explicit-attribute fixtures.
DEFAULT_TOOL_DIA_MM = 25.4 / 8


@dataclass(frozen=True)
class DepthField:
    depth_mm: np.ndarray  # (H, W) float32; mm of material removed from top
    holes_mask: np.ndarray  # (H, W) bool; True where the cut went all the way through
    mm_per_pixel: float
    board_thickness_mm: float

    @property
    def width_mm(self) -> float:
        return self.depth_mm.shape[1] * self.mm_per_pixel

    @property
    def height_mm(self) -> float:
        return self.depth_mm.shape[0] * self.mm_per_pixel


# --------------------------------------------------------------------------- #
# Footprint per cut type
# --------------------------------------------------------------------------- #


def cut_footprint(
    cut: Cut, *, default_tool_dia_mm: float = DEFAULT_TOOL_DIA_MM
) -> sg.base.BaseGeometry:
    """Where, in 2D mm, this cut removes material from the top surface."""
    geom = cut.geometry
    o = cut.offset_mm
    tool_dia = cut.tool_dia_mm if cut.tool_dia_mm is not None else default_tool_dia_mm
    r = tool_dia / 2.0

    if cut.cut_type == "pocket":
        return _safe_buffer(geom, o)

    if cut.cut_type == "inside":
        # Kerf along the inside of the polygon. With +o the whole kerf shifts outward.
        outer = _safe_buffer(geom, o)
        inner = _safe_buffer(geom, o - tool_dia)
        return outer.difference(inner)

    if cut.cut_type == "outside":
        # Kerf along the outside of the polygon. With +o the whole kerf shifts inward.
        outer = _safe_buffer(geom, tool_dia - o)
        inner = _safe_buffer(geom, -o)
        return outer.difference(inner)

    if cut.cut_type == "online":
        # Bit centerline rides the path; sweep is a stadium of width = toolDia.
        return geom.buffer(r, cap_style="round", join_style="round")

    return sg.Polygon()  # guide / anchor: not cut


def _safe_buffer(geom: sg.base.BaseGeometry, distance: float) -> sg.base.BaseGeometry:
    """Buffer that returns an empty geometry instead of failing on extreme inputs."""
    if distance == 0.0:
        return geom
    out = geom.buffer(distance, join_style="round")
    return out if not out.is_empty else sg.Polygon()


# --------------------------------------------------------------------------- #
# Rasterisation
# --------------------------------------------------------------------------- #


def render_depth(
    doc: Document,
    *,
    board_thickness_mm: float,
    mm_per_pixel: float | None = None,
    default_tool_dia_mm: float = DEFAULT_TOOL_DIA_MM,
) -> DepthField:
    pitch = mm_per_pixel or _choose_pitch(doc)
    width_px = max(1, int(np.ceil(doc.width_mm / pitch)))
    height_px = max(1, int(np.ceil(doc.height_mm / pitch)))

    depth = np.zeros((height_px, width_px), dtype=np.float32)

    for cut in doc.cuts:
        if cut.depth_mm is None or cut.depth_mm <= 0:
            continue
        footprint = cut_footprint(cut, default_tool_dia_mm=default_tool_dia_mm)
        if footprint.is_empty:
            continue
        mask = _rasterise_geometry(footprint, width_px, height_px, pitch)
        if not mask.any():
            continue
        # Deepest cut wins at each pixel.
        contribution = np.where(mask, np.float32(cut.depth_mm), np.float32(0.0))
        np.maximum(depth, contribution, out=depth)

    holes = depth >= board_thickness_mm
    np.minimum(depth, np.float32(board_thickness_mm), out=depth)
    return DepthField(
        depth_mm=depth,
        holes_mask=holes,
        mm_per_pixel=pitch,
        board_thickness_mm=board_thickness_mm,
    )


def _choose_pitch(doc: Document) -> float:
    """Pick a pixel pitch that keeps total cells under MAX_PIXELS."""
    pitch = DEFAULT_MM_PER_PX
    while (doc.width_mm / pitch) * (doc.height_mm / pitch) > MAX_PIXELS:
        pitch *= 2
    return pitch


def _rasterise_geometry(
    geom: sg.base.BaseGeometry,
    width_px: int,
    height_px: int,
    mm_per_pixel: float,
) -> np.ndarray:
    """Rasterise any shapely Polygon/MultiPolygon to a boolean (H, W) array."""
    img = Image.new("1", (width_px, height_px), 0)
    draw = ImageDraw.Draw(img)
    inv = 1.0 / mm_per_pixel
    for poly in _iter_polygons(geom):
        ext = [(x * inv, y * inv) for x, y in poly.exterior.coords]
        if len(ext) < 3:
            continue
        draw.polygon(ext, fill=1)
        for ring in poly.interiors:
            hole = [(x * inv, y * inv) for x, y in ring.coords]
            if len(hole) >= 3:
                draw.polygon(hole, fill=0)
    return np.array(img, dtype=bool)


def _iter_polygons(geom: sg.base.BaseGeometry):
    if geom.is_empty:
        return
    if isinstance(geom, sg.Polygon):
        yield geom
    elif isinstance(geom, sg.MultiPolygon):
        yield from geom.geoms
    elif isinstance(geom, sg.GeometryCollection):
        for g in geom.geoms:
            yield from _iter_polygons(g)
    # LineStrings shouldn't reach here — they're buffered upstream into polygons.


# --------------------------------------------------------------------------- #
# PNG export (visual sanity check; no 3D needed)
# --------------------------------------------------------------------------- #


def depth_to_image(field: DepthField) -> Image.Image:
    """Top-down grayscale: white = top surface intact, black = through-cut."""
    remaining = field.board_thickness_mm - field.depth_mm
    remaining = np.clip(remaining, 0.0, field.board_thickness_mm)
    norm = remaining / max(field.board_thickness_mm, 1e-9)
    pixels = (norm * 255).astype(np.uint8)
    pixels[field.holes_mask] = 0  # holes drawn pure black
    return Image.fromarray(pixels, mode="L")
