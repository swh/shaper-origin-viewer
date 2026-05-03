from pathlib import Path

import pytest

EXAMPLES_DIR = Path(__file__).parent.parent / "examples"

EXAMPLE_FILES = {
    "switch_panel": EXAMPLES_DIR / "switch-panel.svg",
    "box_base": EXAMPLES_DIR / "box-base.svg",
    "crossover": EXAMPLES_DIR / "Crossover.svg",
    "anchor_square": EXAMPLES_DIR / "1 inch square with anchor.svg",
}


@pytest.fixture
def examples_dir() -> Path:
    return EXAMPLES_DIR


@pytest.fixture(params=sorted(EXAMPLE_FILES), ids=sorted(EXAMPLE_FILES))
def example_svg(request) -> Path:
    return EXAMPLE_FILES[request.param]
