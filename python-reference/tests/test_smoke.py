from pathlib import Path


def test_example_readable(example_svg: Path) -> None:
    assert example_svg.exists(), example_svg
    text = example_svg.read_text()
    assert text.lstrip().startswith("<"), "expected XML/SVG content"
    assert "shapertools.com/namespaces/shaper" in text
