from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ..config import get_settings
from ..models import BlockType


@dataclass(slots=True)
class ConversionPayload:
    block_id: str
    block_type: BlockType
    image_path: Path
    instruction: str | None
    context_summary: str


@dataclass(slots=True)
class ConversionResult:
    normalized_output: str
    raw_output: str
    warnings: list[str]


class LLMAdapter(Protocol):
    def convert(self, payload: ConversionPayload) -> ConversionResult:
        ...


class MockLLMAdapter:
    def convert(self, payload: ConversionPayload) -> ConversionResult:
        instruction = f" Instruction: {payload.instruction.strip()}." if payload.instruction else ""
        if payload.block_type == BlockType.math:
            output = r"\alpha + \beta = \gamma"
            warnings = ["Mock conversion generated placeholder math output."]
        elif payload.block_type == BlockType.figure:
            output = r"\includegraphics[width=\linewidth]{figure-placeholder}"
            warnings = ["Figure blocks are preserved as placeholders in the mock adapter."]
        elif payload.block_type == BlockType.text:
            output = "Review the extracted note text and replace this placeholder with the final prose."
            warnings = ["Mock conversion generated placeholder text output."]
        else:
            output = "% Review this block manually."
            warnings = ["Unknown blocks require manual confirmation."]

        raw_output = (
            f"provider={get_settings().llm_provider}; block={payload.block_id};"
            f" type={payload.block_type.value};{instruction} {payload.context_summary}"
        )
        return ConversionResult(normalized_output=output, raw_output=raw_output.strip(), warnings=warnings)


def get_llm_adapter() -> LLMAdapter:
    return MockLLMAdapter()
