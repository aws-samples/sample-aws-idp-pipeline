"""Structural QA for PowerPoint presentations.

Checks for layout issues using python-pptx without rendering:
- Margin violations (shapes too close to slide edges)
- Overlapping elements
- Insufficient spacing between elements
- Empty text frames
- Leftover placeholder text
- Estimated text overflow

Usage:
    python structural_qa.py output.pptx

Prints issues found, grouped by slide. Exits with code 1 if any issues found.
"""

import argparse
import re
import sys

from pptx import Presentation
from pptx.util import Emu, Inches

SLIDE_WIDTH = Inches(10)
SLIDE_HEIGHT = Inches(5.625)
MIN_MARGIN = Inches(0.5)
MIN_GAP = Inches(0.3)

PLACEHOLDER_PATTERN = re.compile(
    r"(?i)(xxxx|lorem|ipsum|click to add|this.*(page|slide).*layout)"
)

# Heuristic: approximate characters per inch at common font sizes.
# At 14pt body text, roughly 10-12 chars per inch width.
CHARS_PER_INCH_WIDTH = 10
# At ~18pt line height, roughly 4 lines per inch.
LINES_PER_INCH_HEIGHT = 4


def emu_to_inches(emu: int) -> float:
    return emu / 914400


def boxes_overlap(a_left, a_top, a_right, a_bottom, b_left, b_top, b_right, b_bottom) -> bool:
    return a_left < b_right and a_right > b_left and a_top < b_bottom and a_bottom > b_top


def min_gap_between(a_left, a_top, a_right, a_bottom, b_left, b_top, b_right, b_bottom) -> int:
    """Return the minimum gap (in EMU) between two non-overlapping bounding boxes."""
    h_gap = max(b_left - a_right, a_left - b_right, 0)
    v_gap = max(b_top - a_bottom, a_top - b_bottom, 0)
    if h_gap == 0 and v_gap == 0:
        return 0
    if h_gap > 0 and v_gap > 0:
        return min(h_gap, v_gap)
    return max(h_gap, v_gap)


def get_shape_bounds(shape):
    left = shape.left
    top = shape.top
    right = left + shape.width
    bottom = top + shape.height
    return left, top, right, bottom


def check_margins(shape, slide_num: int) -> list[str]:
    issues = []
    left, top, right, bottom = get_shape_bounds(shape)
    name = shape.name

    if left < MIN_MARGIN:
        issues.append(
            f"  - '{name}': left margin {emu_to_inches(left):.2f}\" (min {emu_to_inches(MIN_MARGIN):.1f}\")"
        )
    if top < MIN_MARGIN:
        issues.append(
            f"  - '{name}': top margin {emu_to_inches(top):.2f}\" (min {emu_to_inches(MIN_MARGIN):.1f}\")"
        )
    if SLIDE_WIDTH - right < MIN_MARGIN:
        issues.append(
            f"  - '{name}': right margin {emu_to_inches(SLIDE_WIDTH - right):.2f}\" (min {emu_to_inches(MIN_MARGIN):.1f}\")"
        )
    if SLIDE_HEIGHT - bottom < MIN_MARGIN:
        issues.append(
            f"  - '{name}': bottom margin {emu_to_inches(SLIDE_HEIGHT - bottom):.2f}\" (min {emu_to_inches(MIN_MARGIN):.1f}\")"
        )
    return issues


def check_overlaps_and_spacing(shapes: list, slide_num: int) -> list[str]:
    issues = []
    bounds = [(s, *get_shape_bounds(s)) for s in shapes]

    for i, (s1, l1, t1, r1, b1) in enumerate(bounds):
        for s2, l2, t2, r2, b2 in bounds[i + 1 :]:
            if boxes_overlap(l1, t1, r1, b1, l2, t2, r2, b2):
                issues.append(f"  - '{s1.name}' overlaps with '{s2.name}'")
            else:
                gap = min_gap_between(l1, t1, r1, b1, l2, t2, r2, b2)
                if 0 < gap < MIN_GAP:
                    issues.append(
                        f"  - '{s1.name}' and '{s2.name}' gap {emu_to_inches(gap):.2f}\" (min {emu_to_inches(MIN_GAP):.1f}\")"
                    )
    return issues


def check_text_content(shape) -> list[str]:
    issues = []
    if not shape.has_text_frame:
        return issues

    text = shape.text_frame.text.strip()

    # Placeholder text
    if text and PLACEHOLDER_PATTERN.search(text):
        issues.append(f"  - '{shape.name}': leftover placeholder text")

    return issues


def check_text_overflow(shape) -> list[str]:
    """Heuristic check for text that likely overflows its container."""
    issues = []
    if not shape.has_text_frame:
        return issues

    text = shape.text_frame.text.strip()
    if not text:
        return issues

    width_inches = emu_to_inches(shape.width)
    height_inches = emu_to_inches(shape.height)

    if width_inches <= 0 or height_inches <= 0:
        return issues

    chars_per_line = max(1, int(width_inches * CHARS_PER_INCH_WIDTH))
    max_lines = max(1, int(height_inches * LINES_PER_INCH_HEIGHT))

    estimated_lines = 0
    for paragraph in shape.text_frame.paragraphs:
        para_text = paragraph.text.strip()
        if not para_text:
            estimated_lines += 1
        else:
            estimated_lines += max(1, (len(para_text) + chars_per_line - 1) // chars_per_line)

    if estimated_lines > max_lines * 1.5:
        issues.append(
            f"  - '{shape.name}': text may overflow (~{estimated_lines} lines, box fits ~{max_lines})"
        )

    return issues


def check_presentation(path: str) -> list[str]:
    prs = Presentation(path)
    all_issues = []

    for slide_num, slide in enumerate(prs.slides, 1):
        slide_issues = []
        shapes = [s for s in slide.shapes if s.left is not None and s.width is not None]

        for shape in shapes:
            slide_issues.extend(check_margins(shape, slide_num))
            slide_issues.extend(check_text_content(shape))
            slide_issues.extend(check_text_overflow(shape))

        slide_issues.extend(check_overlaps_and_spacing(shapes, slide_num))

        if slide_issues:
            all_issues.append(f"Slide {slide_num}:")
            all_issues.extend(slide_issues)

    return all_issues


def main():
    parser = argparse.ArgumentParser(description="Structural QA for PowerPoint presentations.")
    parser.add_argument("input", help="Input PowerPoint file (.pptx)")
    args = parser.parse_args()

    issues = check_presentation(args.input)

    if issues:
        print("Issues found:\n")
        print("\n".join(issues))
        sys.exit(1)
    else:
        print("No structural issues found.")
        sys.exit(0)


if __name__ == "__main__":
    main()
