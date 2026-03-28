from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..models import Block, BlockApproval, BlockType
from ..storage import absolute_path

MATH_ENV_PATTERN = re.compile(r"^\\begin\{(?P<name>equation\*?|align\*?|gather\*?)\}\s*.*\s*\\end\{(?P=name)\}$", re.DOTALL)
TEXT_BLOCK_PATTERN = re.compile(r"^\\begin\{textblock\}\s*.*\s*\\end\{textblock\}$", re.DOTALL)


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


def _ensure_display_math(content: str) -> str:
    normalized = _normalize_text(content)
    if MATH_ENV_PATTERN.match(normalized):
        return normalized
    if normalized.startswith("\\[") and normalized.endswith("\\]"):
        return normalized
    if normalized.startswith("$$") and normalized.endswith("$$"):
        return normalized
    if normalized.startswith("\\(") and normalized.endswith("\\)"):
        normalized = normalized[2:-2].strip()
    elif normalized.startswith("$") and normalized.endswith("$"):
        normalized = normalized[1:-1].strip()
    return f"\\[\n{normalized}\n\\]"


def _ensure_text_block(content: str) -> str:
    normalized = _normalize_text(content)
    if TEXT_BLOCK_PATTERN.match(normalized):
        return normalized
    return "\n".join([r"\begin{textblock}", normalized, r"\end{textblock}"])


def _pending_block_placeholder(block: Block) -> str:
    if not block.crop_path:
        return "% Pending block conversion."

    crop_source = absolute_path(block.crop_path).as_posix()
    return (
        f"% Pending conversion placeholder for block {block.id}\n"
        "\\begin{center}\n"
        f"\\fbox{{\\includegraphics[width=0.9\\linewidth]{{{crop_source}}}}}\n"
        "\\end{center}"
    )


def block_to_latex(block: Block) -> str:
    if block.approval == BlockApproval.rejected:
        return f"% Rejected block {block.id}"

    content = _resolved_block_content(block)
    if content is None:
        return _pending_block_placeholder(block)

    if block.block_type == BlockType.math:
        return _ensure_display_math(content)

    if block.block_type == BlockType.figure:
        return (
            "% Figure placeholder\n"
            "\\begin{figure}[h]\n"
            "\\centering\n"
            f"{content}\n"
            "\\end{figure}"
        )

    if block.block_type == BlockType.unknown:
        return f"% Unknown block {block.id}\n{content}"

    return _ensure_text_block(content)


def build_document_latex(title: str, ordered_blocks: list[Block]) -> str:
    body = "\n\n".join(block_to_latex(block) for block in ordered_blocks if block.approval != BlockApproval.rejected)
    body = body or "% No approved blocks yet."
    return (
        "\\documentclass[11pt]{article}\n"
        "\\usepackage[margin=1in]{geometry}\n"
        "\\usepackage{amsmath}\n"
        "\\usepackage{amssymb}\n"
        "\\usepackage{graphicx}\n"
        "\\usepackage{microtype}\n"
        "\\newenvironment{textblock}{\\par\\noindent\\ignorespaces}{\\par}\n"
        "\\title{" + title.replace("{", "").replace("}", "") + "}\n"
        "\\date{}\n"
        "\\begin{document}\n"
        "\\maketitle\n\n"
        f"{body}\n\n"
        "\\end{document}\n"
    )


@dataclass(slots=True)
class CompileResult:
    status: str
    pdf_path: Path | None
    log_text: str


def compile_latex(tex_path: Path, output_dir: Path) -> CompileResult:
    tectonic = shutil.which("tectonic")
    if tectonic is None:
        return CompileResult(
            status="skipped",
            pdf_path=None,
            log_text="Tectonic is not installed. LaTeX source was generated, but PDF compilation was skipped.",
        )

    completed = subprocess.run(
        [tectonic, "--outdir", str(output_dir), str(tex_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    pdf_path = output_dir / f"{tex_path.stem}.pdf"
    if completed.returncode != 0:
        return CompileResult(status="failed", pdf_path=None, log_text=completed.stdout + "\n" + completed.stderr)
    return CompileResult(status="completed", pdf_path=pdf_path if pdf_path.exists() else None, log_text=completed.stdout)
