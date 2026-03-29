from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from ..models import BlockType


@dataclass(slots=True)
class ProposedBlock:
    x: float
    y: float
    width: float
    height: float
    confidence: float
    block_type: BlockType


def _classify_block(box_width: int, box_height: int, page_width: int, page_height: int, density: float) -> BlockType:
    width_ratio = box_width / max(page_width, 1)
    height_ratio = box_height / max(page_height, 1)
    aspect_ratio = box_width / max(box_height, 1)

    if density < 0.02 and width_ratio > 0.5:
        return BlockType.figure
    if aspect_ratio > 2.4 and height_ratio < 0.18:
        return BlockType.math
    if density > 0.25 and width_ratio > 0.28:
        return BlockType.math
    return BlockType.text


def segment_page(image_path: Path) -> list[ProposedBlock]:
    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(f"Unable to read page image at {image_path}")

    page_height, page_width = image.shape
    blurred = cv2.GaussianBlur(image, (5, 5), 0)
    thresholded = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        35,
        11,
    )

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 9))
    merged = cv2.dilate(thresholded, kernel, iterations=1)
    contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    proposed: list[tuple[int, int, int, int]] = []
    minimum_area = max(int(page_width * page_height * 0.002), 500)

    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        if area < minimum_area:
            continue
        proposed.append((x, y, width, height))

    if not proposed:
        return [ProposedBlock(x=0.08, y=0.08, width=0.84, height=0.84, confidence=0.2, block_type=BlockType.text)]

    proposed.sort(key=lambda box: (box[1], box[0]))
    blocks: list[ProposedBlock] = []
    line_merge_threshold = page_height * 0.035

    current_x, current_y, current_w, current_h = proposed[0]
    for x, y, width, height in proposed[1:]:
        current_bottom = current_y + current_h
        if abs(y - current_y) < line_merge_threshold or abs(y - current_bottom) < line_merge_threshold:
            left = min(current_x, x)
            top = min(current_y, y)
            right = max(current_x + current_w, x + width)
            bottom = max(current_bottom, y + height)
            current_x, current_y, current_w, current_h = left, top, right - left, bottom - top
            continue
        blocks.append(
            _to_proposed_block(current_x, current_y, current_w, current_h, thresholded, page_width, page_height)
        )
        current_x, current_y, current_w, current_h = x, y, width, height

    blocks.append(_to_proposed_block(current_x, current_y, current_w, current_h, thresholded, page_width, page_height))
    return blocks


def _to_proposed_block(
    x: int,
    y: int,
    width: int,
    height: int,
    thresholded: np.ndarray,
    page_width: int,
    page_height: int,
) -> ProposedBlock:
    roi = thresholded[y : y + height, x : x + width]
    density = float(np.count_nonzero(roi)) / float(max(width * height, 1))
    confidence = min(0.98, 0.4 + density)
    block_type = _classify_block(width, height, page_width, page_height, density)
    return ProposedBlock(
        x=x / page_width,
        y=y / page_height,
        width=width / page_width,
        height=height / page_height,
        confidence=round(confidence, 3),
        block_type=block_type,
    )
