# OneMoon Backend

FastAPI backend for PDF/image note ingestion, page rendering, heuristic segmentation, block review, LaTeX assembly, and optional PDF compilation.

## Commands

```bash
uv sync --dev
uv run onemoon-backend
uv run pytest
```

## Notes

- The backend keeps the mock adapter as the default so the end-to-end review loop works without external credentials.
- For real block conversion, set `LLM_PROVIDER=openai` plus `LLM_API_KEY` or `OPENAI_API_KEY` in `apps/backend/.env`, or use the repo-root `.env` with `ONEMOON_LLM_PROVIDER`, `ONEMOON_LLM_MODEL`, and `ONEMOON_API_KEY`.
- Runtime files are written to the repo-level `data/` directory.
