from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..models import Block, BlockApproval, BlockType
from ..storage import absolute_path

# Patterns for detecting LaTeX math environments in stored block output
_LATEX_DISPLAY_MATH = re.compile(
    r"^\s*(?:\\begin\{(?:equation\*?|align\*?|gather\*?)\}(?P<inner1>[\s\S]*?)\\end\{(?:equation\*?|align\*?|gather\*?)\}"
    r"|\\?\$\$(?P<inner2>[\s\S]*?)\\?\$\$"
    r"|\\\[(?P<inner3>[\s\S]*?)\\\])\s*$",
    re.DOTALL,
)
_LATEX_TEXT_BLOCK = re.compile(r"^\\begin\{textblock\}([\s\S]*)\\end\{textblock\}$", re.DOTALL)
_LATEX_FIGURE_ENV = re.compile(
    r"\\includegraphics(?:\[.*?\])?\{(?P<path>[^}]+)\}.*?\\caption\{(?P<caption>[^}]*)\}",
    re.DOTALL,
)
_LATEX_FIGURE_ENV_NO_CAPTION = re.compile(
    r"\\includegraphics(?:\[.*?\])?\{(?P<path>[^}]+)\}",
    re.DOTALL,
)


def _normalize(text: str) -> str:
    return text.strip().replace("\r\n", "\n")


def _resolved_block_content(block: Block) -> str | None:
    for candidate in (block.manual_output, block.generated_output):
        if not candidate:
            continue
        normalized = _normalize(candidate)
        if normalized:
            return normalized
    return None


def _latex_math_to_typst(content: str) -> str:
    """Extract inner expression from a LaTeX display-math environment and wrap in Typst $ ... $."""
    match = _LATEX_DISPLAY_MATH.match(content)
    if match:
        inner = (match.group("inner1") or match.group("inner2") or match.group("inner3") or "").strip()
        return f"$ {inner} $" if inner else f"$ {content} $"
    # Already something we can't parse — wrap as-is
    return f"$ {content} $"


def _latex_text_to_typst(content: str) -> str:
    """Strip LaTeX textblock wrapper and return plain Typst paragraph text."""
    match = _LATEX_TEXT_BLOCK.match(content)
    if match:
        return match.group(1).strip()
    return content


def _latex_figure_to_typst(content: str, image_path: str | None) -> str:
    """Convert a LaTeX figure environment to a Typst #figure() call."""
    fig_match = _LATEX_FIGURE_ENV.search(content)
    if fig_match:
        path = fig_match.group("path")
        caption = fig_match.group("caption").strip()
        return f'#figure(\n  image("{path}"),\n  caption: [{caption}],\n)'

    no_caption_match = _LATEX_FIGURE_ENV_NO_CAPTION.search(content)
    if no_caption_match:
        path = no_caption_match.group("path")
        return f'#figure(\n  image("{path}"),\n  caption: [],\n)'

    # Fallback: use crop path if available
    fallback_path = image_path or "figures/unknown.png"
    return f'#figure(\n  image("{fallback_path}"),\n  caption: [],\n)\n// Original: {content}'


def _pending_block_placeholder(block: Block) -> str:
    if not block.crop_path:
        return "// Pending block conversion."
    crop_source = absolute_path(block.crop_path).as_posix()
    return (
        f"// Pending conversion placeholder for block {block.id}\n"
        f'#figure(\n  image("{crop_source}"),\n  caption: [Pending conversion],\n)'
    )


def block_to_typst(block: Block) -> str:
    if block.approval == BlockApproval.rejected:
        return f"// Rejected block {block.id}"

    content = _resolved_block_content(block)
    if content is None:
        return _pending_block_placeholder(block)

    if block.block_type == BlockType.math:
        return _latex_math_to_typst(content)

    if block.block_type == BlockType.figure:
        return _latex_figure_to_typst(content, block.crop_path)

    if block.block_type == BlockType.unknown:
        return f"// Unknown block {block.id}\n{_latex_text_to_typst(content)}"

    return _latex_text_to_typst(content)


def build_document_body_typst(ordered_blocks: list[Block]) -> str:
    body = "\n\n".join(
        block_to_typst(block) for block in ordered_blocks if block.approval != BlockApproval.rejected
    )
    return body or "// No approved blocks yet."


def build_document_from_body_typst(title: str, body: str) -> str:
    safe_title = title.replace('"', '\\"')
    normalized_body = body.strip() or "// No approved blocks yet."
    return (
        f'#set document(title: "{safe_title}")\n'
        "#set page(margin: 1in)\n"
        "#set text(font: \"New Computer Modern\", size: 11pt)\n"
        "#show math.equation: set text(font: \"New Computer Modern Math\")\n"
        "\n"
        f"= {title}\n"
        "\n"
        f"{normalized_body}\n"
    )


def build_document_typst(title: str, ordered_blocks: list[Block]) -> str:
    return build_document_from_body_typst(title, build_document_body_typst(ordered_blocks))


@dataclass(slots=True)
class CompileResult:
    status: str
    pdf_path: Path | None
    log_text: str


def compile_typst(typ_path: Path, output_dir: Path) -> CompileResult:
    typst_bin = shutil.which("typst")
    if typst_bin is None:
        return CompileResult(
            status="skipped",
            pdf_path=None,
            log_text="Typst is not installed. Typst source was generated, but PDF compilation was skipped.",
        )

    pdf_path = output_dir / f"{typ_path.stem}.pdf"
    completed = subprocess.run(
        [typst_bin, "compile", str(typ_path), str(pdf_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return CompileResult(status="failed", pdf_path=None, log_text=completed.stdout + "\n" + completed.stderr)
    return CompileResult(status="completed", pdf_path=pdf_path if pdf_path.exists() else None, log_text=completed.stdout)
