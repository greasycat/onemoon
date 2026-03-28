# Project Context

- Project name: `onemoon`
- Primary language/runtime: `TypeScript frontend + Python backend`

# Working Rules
- use agent-browser to test interactive components

## Version Control

- Commit for every round of change.
- Use conventional commit messages.
- Keep `CHANGELOG.md` updated with a short developer-facing summary for each completed change.
- Prefer working on feature branches for substantial changes.

## Editing

- Keep changes targeted and coherent by subsystem.
- Reuse established patterns in `apps/frontend/src` and `apps/backend/src/onemoon_backend`.
- Prefer extending the existing API and UI workflow instead of introducing parallel paths.

## Communication

- Summarize the behavioral change and the verification commands that passed.

# Task-Specific Notes

- Constraints: keep the upload/review flow usable with a mock LLM provider when no external model is configured.
- Preferences: preserve the interactive block-review UX and the provider-abstracted backend shape.
- Commands to know:
  - `cd apps/backend && uv run onemoon-backend`
  - `cd apps/backend && uv run pytest`
  - `cd apps/frontend && npm run dev`
  - `cd apps/frontend && npm run build`
- Definition of done: backend tests pass, frontend builds, and the upload-to-review workflow remains runnable locally.
