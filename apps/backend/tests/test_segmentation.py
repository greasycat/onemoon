from pathlib import Path

from PIL import Image, ImageDraw

from onemoon_backend.services.segmentation import segment_page


def test_segment_page_detects_multiple_regions(tmp_path: Path) -> None:
    image_path = tmp_path / "page.png"
    image = Image.new("RGB", (1200, 1600), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((120, 150, 1050, 420), fill="black")
    draw.rectangle((150, 620, 980, 760), fill="black")
    image.save(image_path)

    blocks = segment_page(image_path)

    assert len(blocks) >= 2
    assert all(block.width > 0 for block in blocks)
    assert all(block.height > 0 for block in blocks)
