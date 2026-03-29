from __future__ import annotations

import json
import importlib
import sys
from base64 import b64decode
from io import BytesIO
from pathlib import Path

from onemoon_backend.models import BlockType
from PIL import Image, ImageDraw


def _reload_llm_module(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("ONEMOON_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")

    for module_name in list(sys.modules):
        if module_name == "onemoon_backend.config" or module_name == "onemoon_backend.services.llm":
            del sys.modules[module_name]

    return importlib.import_module("onemoon_backend.services.llm")


def _make_payload(llm_module, tmp_path: Path, block_type: BlockType):
    image_path = tmp_path / "block.png"
    image_path.write_bytes(b"fake-png")
    return llm_module.ConversionPayload(
        block_id="block-1",
        block_type=block_type,
        image_path=image_path,
        figure_output_path="figures/page-001-block-1.png" if block_type == BlockType.figure else None,
        instruction="Keep symbols exact" if block_type == BlockType.math else "Preserve paragraph breaks",
        context_summary="page=1",
    )


def test_get_llm_adapter_falls_back_to_mock_when_openai_key_is_missing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "gpt-5.4")
    monkeypatch.setenv("ONEMOON_LLM_PROVIDER", "openai")
    monkeypatch.setenv("ONEMOON_LLM_MODEL", "gpt-5.4")
    llm_module = _reload_llm_module(monkeypatch)

    adapter = llm_module.get_llm_adapter()
    result = adapter.convert(_make_payload(llm_module, tmp_path, BlockType.text))

    assert isinstance(adapter, llm_module.MockLLMAdapter)
    assert result.normalized_output
    assert any("falling back" in warning.lower() for warning in result.warnings)


def test_openai_adapter_normalizes_text_output_and_embeds_image_input(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    payload = _make_payload(llm_module, tmp_path, BlockType.text)
    captured_request: dict[str, object] = {}

    def fake_request(request_body):
        captured_request.update(request_body)
        return {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "```text\nFirst line.\nSecond line.\n```",
                        }
                    ],
                }
            ],
        }

    adapter._request_response_payload = fake_request  # type: ignore[method-assign]

    result = adapter.convert(payload)

    assert result.normalized_output == "\\begin{textblock}\nFirst line.\nSecond line.\n\\end{textblock}"
    assert captured_request["model"] == "gpt-5.4"
    input_items = captured_request["input"]
    assert isinstance(input_items, list)
    user_content = input_items[0]["content"]
    assert user_content[0]["type"] == "input_text"
    assert "Block type: text." in user_content[0]["text"]
    assert "Return the full text wrapped in \\begin{textblock} ... \\end{textblock}." in user_content[0]["text"]
    assert user_content[1]["type"] == "input_image"
    assert user_content[1]["image_url"].startswith("data:image/png;base64,")


def test_openai_adapter_preserves_full_display_math_environment(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    payload = _make_payload(llm_module, tmp_path, BlockType.math)

    adapter._request_response_payload = lambda _request_body: {  # type: ignore[method-assign]
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "\\[\na^2 + b^2 = c^2\n\\]",
                    }
                ],
            }
        ],
    }

    result = adapter.convert(payload)

    assert result.normalized_output == "\\[\na^2 + b^2 = c^2\n\\]"


def test_openai_adapter_wraps_bare_math_in_display_environment(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    payload = _make_payload(llm_module, tmp_path, BlockType.math)
    captured_request: dict[str, object] = {}

    def fake_request(request_body):
        captured_request.update(request_body)
        return {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "a^2 + b^2 = c^2",
                        }
                    ],
                }
            ],
        }

    adapter._request_response_payload = fake_request  # type: ignore[method-assign]

    result = adapter.convert(payload)

    assert result.normalized_output == "\\[\na^2 + b^2 = c^2\n\\]"
    input_items = captured_request["input"]
    assert isinstance(input_items, list)
    user_content = input_items[0]["content"]
    assert "Return a complete LaTeX display-math environment." in user_content[0]["text"]


def test_openai_adapter_builds_figure_snippet_from_caption_text(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    payload = _make_payload(llm_module, tmp_path, BlockType.figure)
    captured_request: dict[str, object] = {}

    def fake_request(request_body):
        captured_request.update(request_body)
        return {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Free-body diagram of a block on an inclined plane.",
                        }
                    ],
                }
            ],
        }

    adapter._request_response_payload = fake_request  # type: ignore[method-assign]

    result = adapter.convert(payload)

    assert "\\includegraphics[width=0.9\\linewidth]" in result.normalized_output
    assert payload.figure_output_path in result.normalized_output
    assert "\\caption{Free-body diagram of a block on an inclined plane.}" in result.normalized_output
    input_items = captured_request["input"]
    assert isinstance(input_items, list)
    user_content = input_items[0]["content"]
    assert "Block type: figure." in user_content[0]["text"]
    assert "Return plain caption text only." in user_content[0]["text"]
    assert payload.figure_output_path in user_content[0]["text"]


def test_openai_adapter_saves_response_json_when_debug_requested(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    image_path = tmp_path / "block.png"
    Image.new("RGB", (12, 12), "white").save(image_path)
    payload = llm_module.ConversionPayload(
        block_id="block:json",
        block_type=BlockType.text,
        image_path=image_path,
        figure_output_path=None,
        instruction="Keep sentences intact.",
        context_summary="page=1",
        save_debug_image=True,
    )

    adapter._request_response_payload = lambda _request_body: {  # type: ignore[method-assign]
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "First line.\nSecond line.",
                    }
                ],
            }
        ],
    }

    result = adapter.convert(payload)

    assert result.debug_response_path is not None
    response_path = Path(result.debug_response_path)
    saved_payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert saved_payload["provider"] == "openai-responses"
    assert saved_payload["model"] == "gpt-5.4"
    assert saved_payload["normalized_output"] == "\\begin{textblock}\nFirst line.\nSecond line.\n\\end{textblock}"
    assert saved_payload["response"]["status"] == "completed"
    response_path.unlink()
    if result.debug_image_path:
        Path(result.debug_image_path).unlink()


def test_read_image_data_url_flattens_transparent_surround_to_white(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    image_path = tmp_path / "masked-block.png"

    image = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(4, 4), (20, 6), (12, 20)], fill=(0, 0, 0, 255))
    image.save(image_path)

    data_url = llm_module._read_image_data_url(image_path)
    encoded = data_url.split(",", 1)[1]
    flattened = Image.open(BytesIO(b64decode(encoded))).convert("RGB")

    assert flattened.getpixel((1, 1)) == (255, 255, 255)
    assert flattened.getpixel((12, 10)) == (0, 0, 0)


def test_read_image_data_url_flattens_full_bounds_transparency_to_white(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    image_path = tmp_path / "masked-block-full-bounds.png"

    image = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(12, 0), (23, 12), (12, 23), (0, 12)], fill=(0, 0, 0, 255))
    image.save(image_path)

    data_url = llm_module._read_image_data_url(image_path)
    encoded = data_url.split(",", 1)[1]
    flattened = Image.open(BytesIO(b64decode(encoded))).convert("RGB")

    assert flattened.getpixel((0, 0)) == (255, 255, 255)
    assert flattened.getpixel((12, 12)) == (0, 0, 0)


def test_mock_adapter_saves_prepared_debug_crop_when_requested(tmp_path: Path) -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    image_path = tmp_path / "masked-block.png"

    image = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(4, 4), (20, 6), (12, 20)], fill=(0, 0, 0, 255))
    image.save(image_path)

    payload = llm_module.ConversionPayload(
        block_id="block:debug",
        block_type=BlockType.text,
        image_path=image_path,
        figure_output_path=None,
        instruction=None,
        context_summary="page=1",
        save_debug_image=True,
    )

    result = llm_module.MockLLMAdapter().convert(payload)

    assert result.debug_image_path is not None
    assert result.debug_response_path is not None
    debug_image = Path(result.debug_image_path)
    response_json = Path(result.debug_response_path)
    assert debug_image.exists()
    assert response_json.exists()
    assert debug_image.parent.name == "onemoon-masked-crops"
    assert response_json.parent.name == "onemoon-masked-crops"

    flattened = Image.open(debug_image).convert("RGB")
    assert flattened.getpixel((1, 1)) == (255, 255, 255)
    assert flattened.getpixel((12, 10)) == (0, 0, 0)
    saved_payload = json.loads(response_json.read_text(encoding="utf-8"))
    assert saved_payload["block_id"] == "block:debug"
    assert saved_payload["normalized_output"] == llm_module.TEXT_PLACEHOLDER
    assert saved_payload["response"]["raw_output"].startswith("provider=")
    debug_image.unlink()
    response_json.unlink()


def test_mock_adapter_document_merge_reuses_source_and_warns_when_suggestion_is_present() -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    payload = llm_module.DocumentMergePayload(
        document_id="doc-1",
        title="Notebook",
        source="\\begin{textblock}\nMerged reviewer copy.\n\\end{textblock}",
        suggestion="Tighten repeated prose.",
    )

    result = llm_module.MockLLMAdapter().merge_document(payload)

    assert result.merged_source == payload.source
    assert any("without applying the suggestion" in warning for warning in result.warnings)


def test_openai_adapter_document_merge_strips_document_wrapper() -> None:
    llm_module = importlib.import_module("onemoon_backend.services.llm")
    adapter = llm_module.OpenAIResponsesLLMAdapter(
        api_key="test-key",
        model="gpt-5.4",
        base_url="https://api.openai.com/v1",
        timeout_seconds=10,
    )
    payload = llm_module.DocumentMergePayload(
        document_id="doc-1",
        title="Notebook",
        source="\\begin{textblock}\nOriginal body.\n\\end{textblock}",
        suggestion="Preserve ordering.",
    )

    adapter._request_response_payload = lambda _request_body: {  # type: ignore[method-assign]
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "\\documentclass{article}\n\\begin{document}\n\\maketitle\n\\begin{textblock}\nMerged body.\n\\end{textblock}\n\\end{document}",
                    }
                ],
            }
        ],
    }

    result = adapter.merge_document(payload)

    assert result.merged_source == "\\begin{textblock}\nMerged body.\n\\end{textblock}"
