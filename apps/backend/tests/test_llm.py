from __future__ import annotations

import importlib
import sys
from pathlib import Path

from onemoon_backend.models import BlockType


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

    assert result.normalized_output == "First line.\nSecond line."
    assert captured_request["model"] == "gpt-5.4"
    input_items = captured_request["input"]
    assert isinstance(input_items, list)
    user_content = input_items[0]["content"]
    assert user_content[0]["type"] == "input_text"
    assert "Block type: text." in user_content[0]["text"]
    assert user_content[1]["type"] == "input_image"
    assert user_content[1]["image_url"].startswith("data:image/png;base64,")


def test_openai_adapter_strips_display_math_wrappers(tmp_path: Path) -> None:
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

    assert result.normalized_output == "a^2 + b^2 = c^2"


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
    assert payload.image_path.as_posix() in result.normalized_output
    assert "\\caption{Free-body diagram of a block on an inclined plane.}" in result.normalized_output
    input_items = captured_request["input"]
    assert isinstance(input_items, list)
    user_content = input_items[0]["content"]
    assert "Block type: figure." in user_content[0]["text"]
    assert "Return plain caption text only." in user_content[0]["text"]
