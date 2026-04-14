from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..models import Block, BlockApproval, BlockType
from ..storage import absolute_path

TYPST_MATH_PATTERN = re.compile(r"^\$\s+.*\s+\$$", re.DOTALL)

_LATEX_MATH_ENV_PATTERN = re.compile(
    r"^\\begin\{(?:equation\*?|align\*?|gather\*?)\}(.*?)\\end\{(?:equation\*?|align\*?|gather\*?)\}$",
    re.DOTALL,
)
_LATEX_DISPLAY_MATH_PATTERN = re.compile(r"^\\\[(.*?)\\\]$", re.DOTALL)
_LATEX_INLINE_MATH_PATTERN = re.compile(r"^\$\$(.*?)\$\$$", re.DOTALL)
_LATEX_SINGLE_DOLLAR_PATTERN = re.compile(r"^\$(.*?)\$$", re.DOTALL)


def _normalize_text(output: str) -> str:
    return output.strip().replace("\r\n", "\n")


def _resolved_block_content(block: Block) -> str | None:
    for candidate in (block.manual_output, block.generated_output):
        if not candidate:
            continue
        normalized = _normalize_text(candidate)
        if normalized:
            return normalized
    return None


def _latex_math_to_typst(content: str) -> str:
    """Strip known LaTeX math delimiters and return raw expression."""
    m = _LATEX_MATH_ENV_PATTERN.match(content)
    if m:
        return m.group(1).strip()
    m = _LATEX_DISPLAY_MATH_PATTERN.match(content)
    if m:
        return m.group(1).strip()
    m = _LATEX_INLINE_MATH_PATTERN.match(content)
    if m:
        return m.group(1).strip()
    m = _LATEX_SINGLE_DOLLAR_PATTERN.match(content)
    if m:
        return m.group(1).strip()
    return content


def _ensure_display_math_typst(content: str) -> str:
    normalized = _normalize_text(content)
    # Already a Typst block-math expression: $ ... $ with surrounding spaces
    if TYPST_MATH_PATTERN.match(normalized):
        return normalized
    # Strip any LaTeX delimiters and re-wrap
    inner = _latex_math_to_typst(normalized)
    return f"$\n  {inner}\n$"


def _pending_block_placeholder_typst(block: Block) -> str:
    if not block.crop_path:
        return "// Pending block conversion."

    crop_source = absolute_path(block.crop_path).as_posix()
    return (
        f"// Pending conversion placeholder for block {block.id}\n"
        "#figure(\n"
        f'  image("{crop_source}", width: 90%),\n'
        "  caption: []\n"
        ")"
    )


def block_to_typst(block: Block) -> str:
    if block.approval == BlockApproval.rejected:
        return f"// Rejected block {block.id}"

    content = _resolved_block_content(block)
    if content is None:
        return _pending_block_placeholder_typst(block)

    if block.block_type == BlockType.math:
        return _ensure_display_math_typst(content)

    if block.block_type == BlockType.figure:
        return (
            "// Figure placeholder\n"
            "#figure(\n"
            f"  {content},\n"
            "  caption: []\n"
            ")"
        )

    if block.block_type == BlockType.unknown:
        return f"// Unknown block {block.id}\n{content}"

    # text block — plain Typst paragraph
    return content


def build_document_body_typst(ordered_blocks: list[Block]) -> str:
    body = "\n\n".join(
        block_to_typst(block)
        for block in ordered_blocks
        if block.approval != BlockApproval.rejected
    )
    return body or "// No approved blocks yet."


def build_document_from_body_typst(title: str, body: str) -> str:
    normalized_body = body.strip() or "// No approved blocks yet."
    safe_title = title.replace('"', '\\"')
    return (
        f'#set document(title: "{safe_title}")\n'
        "#set page(paper: \"us-letter\", margin: 1in)\n"
        "#set text(size: 11pt)\n\n"
        f"= {title}\n\n"
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
    typst = shutil.which("typst")
    if typst is None:
        return CompileResult(
            status="skipped",
            pdf_path=None,
            log_text="Typst is not installed. Typst source was generated, but PDF compilation was skipped.",
        )

    pdf_path = output_dir / f"{typ_path.stem}.pdf"
    completed = subprocess.run(
        [typst, "compile", str(typ_path), str(pdf_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return CompileResult(status="failed", pdf_path=None, log_text=completed.stdout + "\n" + completed.stderr)
    return CompileResult(status="completed", pdf_path=pdf_path if pdf_path.exists() else None, log_text=completed.stdout)
