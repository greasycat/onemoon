from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..models import Block, BlockApproval, BlockType


def _normalize_text(output: str) -> str:
    return output.strip().replace("\r\n", "\n")


def block_to_latex(block: Block) -> str:
    content = block.manual_output or block.generated_output or "% Pending block review."
    content = _normalize_text(content)

    if block.approval == BlockApproval.rejected:
        return f"% Rejected block {block.id}"

    if block.block_type == BlockType.math:
        if content.startswith("\\[") or content.startswith("$$"):
            return content
        return f"\\[\n{content}\n\\]"

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

    return content


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
