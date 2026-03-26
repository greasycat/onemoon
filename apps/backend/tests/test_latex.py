from onemoon_backend.models import Block, BlockApproval, BlockType
from onemoon_backend.services.latex import block_to_latex, build_document_latex


def make_block(block_type: BlockType, output: str, approval: BlockApproval = BlockApproval.approved) -> Block:
    return Block(
        id="block",
        page_id="page",
        order_index=0,
        block_type=block_type,
        approval=approval,
        x=0.1,
        y=0.1,
        width=0.4,
        height=0.2,
        confidence=1.0,
        generated_output=output,
        warnings=[],
    )


def test_math_blocks_are_wrapped_in_display_math() -> None:
    latex = block_to_latex(make_block(BlockType.math, "a^2 + b^2 = c^2"))
    assert latex.startswith("\\[")
    assert "a^2 + b^2 = c^2" in latex


def test_document_builder_includes_text_and_math_blocks() -> None:
    source = build_document_latex(
        "Notebook",
        [
            make_block(BlockType.text, "This is a note."),
            make_block(BlockType.math, "x + y = z"),
        ],
    )
    assert "\\documentclass" in source
    assert "This is a note." in source
    assert "\\[" in source
