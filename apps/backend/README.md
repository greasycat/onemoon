# OneMoon Backend

FastAPI backend for PDF/image note ingestion, page rendering, heuristic segmentation, block review, LaTeX assembly, and optional PDF compilation.

## Commands

```bash
uv sync --dev
uv run onemoon-backend
uv run pytest
```

## Notes

- The current `LLMAdapter` implementation is a mock provider so the end-to-end review loop works without external credentials.
- Runtime files are written to the repo-level `data/` directory.
