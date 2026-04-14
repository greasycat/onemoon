from __future__ import annotations

import base64
import json
import re
import tempfile
from dataclasses import dataclass
from io import BytesIO
from mimetypes import guess_type
from pathlib import Path
from typing import Any, Protocol
from urllib import error, request
from uuid import uuid4

from PIL import Image

from ..config import get_settings
from ..models import BlockType

TEXT_PLACEHOLDER = "\n".join(
    [
        r"\begin{textblock}",
        "Review the extracted note text and replace this placeholder with the final prose.",
        r"\end{textblock}",
    ]
)
TEXT_PLACEHOLDER_TYPST = "Review the extracted note text and replace this placeholder with the final prose."
MATH_PLACEHOLDER = "\n".join([r"\[", r"\alpha + \beta = \gamma", r"\]"])
MATH_PLACEHOLDER_TYPST = "$\n  alpha + beta = gamma\n$"
FIGURE_DESCRIPTION_PLACEHOLDER = "Replace this caption with a concise description of the figure."
OPENAI_PROVIDER_NAMES = {"openai", "openai-responses", "openai_responses"}
FENCED_BLOCK_PATTERN = re.compile(r"^```[a-zA-Z0-9_-]*\s*|\s*```$", re.DOTALL)
MATH_ENV_PATTERN = re.compile(
    r"^\\begin\{(?P<name>equation\*?|align\*?|gather\*?)\}\s*.*\s*\\end\{(?P=name)\}$",
    re.DOTALL,
)
TEXT_BLOCK_PATTERN = re.compile(r"^\\begin\{textblock\}\s*.*\s*\\end\{textblock\}$", re.DOTALL)


@dataclass(slots=True)
class ConversionPayload:
    block_id: str
    block_type: BlockType
    image_path: Path
    figure_output_path: str | None
    instruction: str | None
    context_summary: str
    output_format: str = "latex"
    save_debug_image: bool = False


@dataclass(slots=True)
class ConversionResult:
    normalized_output: str
    raw_output: str
    warnings: list[str]
    debug_image_path: str | None = None
    debug_response_path: str | None = None


@dataclass(slots=True)
class DocumentMergePayload:
    document_id: str
    title: str
    source: str
    suggestion: str | None
    output_format: str = "latex"


@dataclass(slots=True)
class DocumentMergeResult:
    merged_source: str
    raw_output: str
    warnings: list[str]


@dataclass(slots=True)
class PreparedLLMImage:
    mime_type: str
    image_bytes: bytes


class LLMAdapter(Protocol):
    def convert(self, payload: ConversionPayload) -> ConversionResult:
        ...

    def merge_document(self, payload: DocumentMergePayload) -> DocumentMergeResult:
        ...


def _strip_markdown_fences(value: str) -> str:
    stripped = value.strip()
    if not stripped.startswith("```"):
        return stripped
    return FENCED_BLOCK_PATTERN.sub("", stripped).strip()


def _normalize_text_output(value: str) -> str:
    return _strip_markdown_fences(value).replace("\r\n", "\n").strip()


def _normalize_math_output(value: str) -> str:
    cleaned = _normalize_text_output(value)
    if not cleaned:
        return cleaned
    if MATH_ENV_PATTERN.match(cleaned):
        return cleaned
    if cleaned.startswith(r"\[") and cleaned.endswith(r"\]"):
        return cleaned
    if cleaned.startswith("$$") and cleaned.endswith("$$"):
        return cleaned
    if cleaned.startswith(r"\(") and cleaned.endswith(r"\)"):
        cleaned = cleaned[2:-2].strip()
    elif cleaned.startswith("$") and cleaned.endswith("$"):
        cleaned = cleaned[1:-1].strip()
    return "\n".join([r"\[", cleaned, r"\]"])


def _normalize_text_block_output(value: str) -> str:
    cleaned = _normalize_text_output(value)
    if not cleaned:
        return cleaned
    if TEXT_BLOCK_PATTERN.match(cleaned):
        return cleaned
    return "\n".join([r"\begin{textblock}", cleaned, r"\end{textblock}"])


def _normalize_document_merge_output(value: str) -> str:
    cleaned = _normalize_text_output(value)
    if not cleaned:
        return cleaned

    begin_document = cleaned.find(r"\begin{document}")
    end_document = cleaned.rfind(r"\end{document}")
    if begin_document >= 0 and end_document > begin_document:
        cleaned = cleaned[begin_document + len(r"\begin{document}") : end_document].strip()

    if cleaned.startswith(r"\maketitle"):
        cleaned = cleaned[len(r"\maketitle") :].strip()
    return cleaned


def _escape_latex_text(value: str) -> str:
    escaped = value.replace("\\", r"\textbackslash{}")
    replacements = {
        "{": r"\{",
        "}": r"\}",
        "%": r"\%",
        "&": r"\&",
        "_": r"\_",
        "#": r"\#",
        "$": r"\$",
        "^": r"\^{}",
        "~": r"\~{}",
    }
    for source, target in replacements.items():
        escaped = escaped.replace(source, target)
    return escaped


def _build_figure_snippet(image_path: str, description: str) -> str:
    caption = _escape_latex_text(_normalize_text_output(description) or FIGURE_DESCRIPTION_PLACEHOLDER)
    return "\n".join(
        [
            f"\\includegraphics[width=0.9\\linewidth]{{{image_path}}}",
            f"\\caption{{{caption}}}",
        ]
    )


def _output_for_block_type(block_type: BlockType, value: str) -> str:
    if block_type == BlockType.math:
        return _normalize_math_output(value)
    if block_type == BlockType.text:
        return _normalize_text_block_output(value)
    return _normalize_text_output(value)


_TYPST_MATH_BLOCK_PATTERN = re.compile(r"^\$\s+.*\s+\$$", re.DOTALL)
_LATEX_ENV_CONTENT_PATTERN = re.compile(
    r"^\\begin\{(?:equation\*?|align\*?|gather\*?)\}(.*?)\\end\{(?:equation\*?|align\*?|gather\*?)\}$",
    re.DOTALL,
)
_LATEX_DISPLAY_MATH_CONTENT_PATTERN = re.compile(r"^\\\[(.*?)\\\]$", re.DOTALL)
_LATEX_DOLLAR_DISPLAY_CONTENT_PATTERN = re.compile(r"^\$\$(.*?)\$\$$", re.DOTALL)
_LATEX_DOLLAR_INLINE_CONTENT_PATTERN = re.compile(r"^\$(.*?)\$$", re.DOTALL)


def _normalize_math_output_typst(value: str) -> str:
    cleaned = _normalize_text_output(value)
    if not cleaned:
        return cleaned
    if _TYPST_MATH_BLOCK_PATTERN.match(cleaned):
        return cleaned
    # Strip known LaTeX wrappers
    for pattern in (
        _LATEX_ENV_CONTENT_PATTERN,
        _LATEX_DISPLAY_MATH_CONTENT_PATTERN,
        _LATEX_DOLLAR_DISPLAY_CONTENT_PATTERN,
        _LATEX_DOLLAR_INLINE_CONTENT_PATTERN,
    ):
        m = pattern.match(cleaned)
        if m:
            inner = m.group(1).strip()
            return f"$\n  {inner}\n$"
    return f"$\n  {cleaned}\n$"


def _build_figure_snippet_typst(image_path: str, description: str) -> str:
    caption = _normalize_text_output(description) or FIGURE_DESCRIPTION_PLACEHOLDER
    return f'#figure(\n  image("{image_path}", width: 90%),\n  caption: [{caption}]\n)'


def _output_for_block_type_typst(block_type: BlockType, value: str) -> str:
    if block_type == BlockType.math:
        return _normalize_math_output_typst(value)
    # text and others: plain content
    return _normalize_text_output(value)


def _prepare_llm_image(image_path: Path) -> PreparedLLMImage:
    mime_type = guess_type(image_path.name)[0] or "image/png"
    image_bytes = image_path.read_bytes()
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            rgba_image = image.convert("RGBA")
            alpha_channel = rgba_image.getchannel("A")
            alpha_extrema = alpha_channel.getextrema()
            if alpha_extrema and alpha_extrema[0] < 255:
                flattened = Image.new("RGB", rgba_image.size, "white")
                flattened.paste(rgba_image, mask=alpha_channel)
                buffer = BytesIO()
                flattened.save(buffer, format="PNG")
                image_bytes = buffer.getvalue()
                mime_type = "image/png"
    except OSError:
        pass

    return PreparedLLMImage(mime_type=mime_type, image_bytes=image_bytes)


def _prepared_image_data_url(prepared_image: PreparedLLMImage) -> str:
    encoded = base64.b64encode(prepared_image.image_bytes).decode("ascii")
    return f"data:{prepared_image.mime_type};base64,{encoded}"


def _read_image_data_url(image_path: Path) -> str:
    return _prepared_image_data_url(_prepare_llm_image(image_path))


def _debug_target_dir() -> Path:
    target_dir = Path(tempfile.gettempdir()) / "onemoon-masked-crops"
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir


def _new_debug_artifact_stem(block_id: str) -> str:
    safe_block_id = re.sub(r"[^A-Za-z0-9_-]+", "-", block_id).strip("-") or "block"
    return f"{safe_block_id}-{uuid4().hex[:8]}"


def _write_debug_image(prepared_image: PreparedLLMImage, *, artifact_stem: str) -> str:
    suffix = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(prepared_image.mime_type, ".bin")
    target_path = _debug_target_dir() / f"{artifact_stem}{suffix}"
    target_path.write_bytes(prepared_image.image_bytes)
    return target_path.as_posix()


def _build_debug_response_record(
    payload: ConversionPayload,
    *,
    provider: str,
    model: str | None,
    response: Any,
    normalized_output: str,
    warnings: list[str],
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "provider": provider,
        "block_id": payload.block_id,
        "block_type": payload.block_type.value,
        "instruction": payload.instruction,
        "context_summary": payload.context_summary,
        "normalized_output": normalized_output,
        "warnings": warnings,
        "response": response,
    }
    if payload.figure_output_path:
        record["figure_output_path"] = payload.figure_output_path
    if model:
        record["model"] = model
    return record


def _write_debug_response_json(response_payload: dict[str, Any], *, artifact_stem: str) -> str:
    target_path = _debug_target_dir() / f"{artifact_stem}.json"
    target_path.write_text(json.dumps(response_payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return target_path.as_posix()


def _collect_output_text(node: Any) -> list[str]:
    texts: list[str] = []
    if isinstance(node, list):
        for item in node:
            texts.extend(_collect_output_text(item))
        return texts

    if not isinstance(node, dict):
        return texts

    node_type = node.get("type")
    text_value = node.get("text")
    if node_type in {"output_text", "text"} and isinstance(text_value, str):
        texts.append(text_value)

    for value in node.values():
        texts.extend(_collect_output_text(value))
    return texts


def _extract_response_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = payload.get("output", [])
    texts = [text.strip() for text in _collect_output_text(output) if isinstance(text, str) and text.strip()]
    if texts:
        return "\n\n".join(texts)

    status = payload.get("status")
    incomplete_details = payload.get("incomplete_details")
    if incomplete_details:
        raise RuntimeError(f"OpenAI response was incomplete: {json.dumps(incomplete_details, ensure_ascii=True)}")
    raise RuntimeError(f"OpenAI response did not contain text output (status={status!r}).")


class MockLLMAdapter:
    def __init__(self, fallback_reason: str | None = None) -> None:
        self.fallback_reason = fallback_reason

    def convert(self, payload: ConversionPayload) -> ConversionResult:
        instruction = f" Instruction: {payload.instruction.strip()}." if payload.instruction else ""
        warnings: list[str] = []
        if self.fallback_reason:
            warnings.append(self.fallback_reason)
        debug_image_path = None
        debug_response_path = None
        debug_artifact_stem = _new_debug_artifact_stem(payload.block_id) if payload.save_debug_image else None
        if payload.save_debug_image:
            debug_image_path = _write_debug_image(
                _prepare_llm_image(payload.image_path),
                artifact_stem=debug_artifact_stem or _new_debug_artifact_stem(payload.block_id),
            )

        is_typst = payload.output_format == "typst"
        if payload.block_type == BlockType.math:
            output = MATH_PLACEHOLDER_TYPST if is_typst else MATH_PLACEHOLDER
            warnings.append("Mock conversion generated placeholder math output.")
        elif payload.block_type == BlockType.figure:
            figure_path = payload.figure_output_path or payload.image_path.as_posix()
            output = (
                _build_figure_snippet_typst(figure_path, FIGURE_DESCRIPTION_PLACEHOLDER)
                if is_typst
                else _build_figure_snippet(figure_path, FIGURE_DESCRIPTION_PLACEHOLDER)
            )
            warnings.append("Mock conversion generated a placeholder figure caption.")
        elif payload.block_type == BlockType.text:
            output = TEXT_PLACEHOLDER_TYPST if is_typst else TEXT_PLACEHOLDER
            warnings.append("Mock conversion generated placeholder text output.")
        else:
            output = "// Review this block manually." if is_typst else "% Review this block manually."
            warnings.append("Unknown blocks require manual confirmation.")

        raw_output = (
            f"provider={get_settings().llm_provider}; block={payload.block_id};"
            f" type={payload.block_type.value};{instruction} {payload.context_summary}"
        )
        if debug_artifact_stem:
            debug_response_path = _write_debug_response_json(
                _build_debug_response_record(
                    payload,
                    provider=get_settings().llm_provider.strip() or "mock",
                    model=None,
                    response={"raw_output": raw_output.strip()},
                    normalized_output=output,
                    warnings=warnings,
                ),
                artifact_stem=debug_artifact_stem,
            )
        return ConversionResult(
            normalized_output=output,
            raw_output=raw_output.strip(),
            warnings=warnings,
            debug_image_path=debug_image_path,
            debug_response_path=debug_response_path,
        )

    def merge_document(self, payload: DocumentMergePayload) -> DocumentMergeResult:
        warnings: list[str] = []
        if self.fallback_reason:
            warnings.append(self.fallback_reason)
        raw_output = (
            f"provider={get_settings().llm_provider}; document={payload.document_id};"
            f" suggestion={payload.suggestion.strip() if payload.suggestion else ''}"
        )
        if payload.suggestion:
            warnings.append("Mock merge reused the current merged output without applying the suggestion.")
        empty_placeholder = "// No approved blocks yet." if payload.output_format == "typst" else "% No approved blocks yet."
        return DocumentMergeResult(
            merged_source=payload.source.strip() or empty_placeholder,
            raw_output=raw_output.strip(),
            warnings=warnings,
        )


class OpenAIResponsesLLMAdapter:
    def __init__(self, *, api_key: str, model: str, base_url: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    @property
    def responses_url(self) -> str:
        return self.base_url if self.base_url.endswith("/responses") else f"{self.base_url}/responses"

    def _build_prompt(self, payload: ConversionPayload) -> str:
        is_typst = payload.output_format == "typst"
        format_name = "Typst" if is_typst else "LaTeX"
        shared = [
            f"You are converting a cropped note block into content for a {format_name} document.",
            "Read the image carefully and return only the final content.",
            "Do not add markdown fences, explanations, or confidence commentary.",
            f"Context: {payload.context_summary}.",
        ]
        if payload.instruction:
            shared.append(f"User instruction: {payload.instruction.strip()}.")
        if payload.block_type == BlockType.figure and payload.figure_output_path:
            if is_typst:
                shared.append(
                    f'Reference the packaged figure asset with the relative Typst path "{payload.figure_output_path}".'
                )
            else:
                shared.append(
                    f"Reference the packaged figure asset with the relative LaTeX path {payload.figure_output_path}."
                )

        if payload.block_type == BlockType.math:
            if is_typst:
                shared.extend(
                    [
                        "Block type: math.",
                        "Return a Typst display-math block.",
                        "Wrap the expression in $ ... $ with a space after the opening $ and before the closing $.",
                        "Example: $ x^2 + y^2 = z^2 $",
                        "Do not return LaTeX syntax, prose, or markdown fences.",
                    ]
                )
            else:
                shared.extend(
                    [
                        "Block type: math.",
                        "Return a complete LaTeX display-math environment.",
                        "Wrap the final math in \\[...\\] or an equivalent equation, align, or gather environment.",
                        "Do not return prose, markdown fences, or bare math without an environment.",
                    ]
                )
        elif payload.block_type == BlockType.figure:
            shared.extend(
                [
                    "Block type: figure.",
                    "Describe the figure in one concise sentence suitable as a caption.",
                    "Return plain caption text only.",
                    "Do not return markup commands, markdown fences, labels, or surrounding commentary.",
                ]
            )
        else:
            if is_typst:
                shared.extend(
                    [
                        "Block type: text.",
                        "Return the full text as plain Typst paragraph content.",
                        "Do not wrap in any environment or add markup.",
                        "Preserve line breaks only when they reflect the visible note structure.",
                    ]
                )
            else:
                shared.extend(
                    [
                        "Block type: text.",
                        "Return the full text wrapped in \\begin{textblock} ... \\end{textblock}.",
                        "Return only that text block.",
                        "Preserve line breaks only when they reflect the visible note structure.",
                    ]
                )
        return "\n".join(shared)

    def _build_request_body(self, payload: ConversionPayload, prepared_image: PreparedLLMImage) -> dict[str, Any]:
        return {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": self._build_prompt(payload)},
                        {"type": "input_image", "image_url": _prepared_image_data_url(prepared_image)},
                    ],
                }
            ],
        }

    def _build_document_merge_prompt(self, payload: DocumentMergePayload) -> str:
        is_typst = payload.output_format == "typst"
        if is_typst:
            lines = [
                "You are merging reviewed Typst snippets from a note extraction workflow into a coherent Typst document body.",
                "Return only the final Typst document body content (no #set directives, no title heading).",
                "Preserve all factual content from the source unless the reviewer suggestion explicitly requests a change.",
                "Keep the output valid Typst and preserve math expressions and figure elements when they already exist.",
                "Do not add markdown fences or commentary.",
                f"Document title: {payload.title}.",
            ]
        else:
            lines = [
                "You are merging reviewed LaTeX snippets from a note extraction workflow into a coherent LaTeX document body.",
                "Return only the final LaTeX document body.",
                "Do not return \\documentclass, package declarations, \\begin{document}, \\end{document}, or \\maketitle.",
                "Preserve all factual content from the source unless the reviewer suggestion explicitly requests a change.",
                "Keep the output valid LaTeX and preserve math environments and figure environments when they already exist.",
                "Do not add markdown fences or commentary.",
                f"Document title: {payload.title}.",
            ]
        if payload.suggestion:
            lines.append(f"Reviewer suggestion: {payload.suggestion.strip()}.")
        else:
            lines.append("Reviewer suggestion: none.")
        return "\n".join(lines)

    def _build_document_merge_request_body(self, payload: DocumentMergePayload) -> dict[str, Any]:
        return {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": self._build_document_merge_prompt(payload)},
                        {"type": "input_text", "text": payload.source},
                    ],
                }
            ],
        }

    def _request_response_payload(self, request_body: dict[str, Any]) -> dict[str, Any]:
        http_request = request.Request(
            self.responses_url,
            data=json.dumps(request_body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with request.urlopen(http_request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            detail = error_body or exc.reason
            raise RuntimeError(f"OpenAI request failed ({exc.code}): {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"OpenAI request failed: {exc.reason}") from exc

    def convert(self, payload: ConversionPayload) -> ConversionResult:
        prepared_image = _prepare_llm_image(payload.image_path)
        debug_artifact_stem = _new_debug_artifact_stem(payload.block_id) if payload.save_debug_image else None
        debug_image_path = (
            _write_debug_image(prepared_image, artifact_stem=debug_artifact_stem)
            if debug_artifact_stem
            else None
        )
        response_payload = self._request_response_payload(self._build_request_body(payload, prepared_image))
        output = _extract_response_text(response_payload)
        is_typst = payload.output_format == "typst"
        if payload.block_type == BlockType.figure:
            figure_path = payload.figure_output_path or payload.image_path.as_posix()
            normalized_output = (
                _build_figure_snippet_typst(figure_path, output)
                if is_typst
                else _build_figure_snippet(figure_path, output)
            )
        elif is_typst:
            normalized_output = _output_for_block_type_typst(payload.block_type, output)
        else:
            normalized_output = _output_for_block_type(payload.block_type, output)
        if not normalized_output:
            raise RuntimeError("OpenAI response produced an empty conversion.")
        debug_response_path = (
            _write_debug_response_json(
                _build_debug_response_record(
                    payload,
                    provider="openai-responses",
                    model=self.model,
                    response=response_payload,
                    normalized_output=normalized_output,
                    warnings=[],
                ),
                artifact_stem=debug_artifact_stem,
            )
            if debug_artifact_stem
            else None
        )

        return ConversionResult(
            normalized_output=normalized_output,
            raw_output=json.dumps(response_payload, ensure_ascii=True),
            warnings=[],
            debug_image_path=debug_image_path,
            debug_response_path=debug_response_path,
        )

    def merge_document(self, payload: DocumentMergePayload) -> DocumentMergeResult:
        response_payload = self._request_response_payload(self._build_document_merge_request_body(payload))
        merged_source = _normalize_document_merge_output(_extract_response_text(response_payload))
        if not merged_source:
            raise RuntimeError("OpenAI response produced an empty merged document.")
        return DocumentMergeResult(
            merged_source=merged_source,
            raw_output=json.dumps(response_payload, ensure_ascii=True),
            warnings=[],
        )


def get_llm_adapter() -> LLMAdapter:
    settings = get_settings()
    provider = settings.llm_provider.strip().lower()

    if provider in {"", "mock"}:
        return MockLLMAdapter()

    if provider in OPENAI_PROVIDER_NAMES:
        if not settings.llm_api_key:
            return MockLLMAdapter(
                fallback_reason="OpenAI provider requested but no API key is configured. Falling back to the mock adapter."
            )
        return OpenAIResponsesLLMAdapter(
            api_key=settings.llm_api_key,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
            timeout_seconds=settings.llm_timeout_seconds,
        )

    return MockLLMAdapter(
        fallback_reason=f"Unsupported LLM provider '{settings.llm_provider}'. Falling back to the mock adapter."
    )
