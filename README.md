# OneMoon

OneMoon is a full-stack web app for turning handwritten notes, screenshots, and PDFs into reviewable LaTeX. The current scaffold includes:

- A `React + TypeScript + Vite` frontend with login, project management, document upload, page-first manual segmentation, block editing, and draft save/discard workflow.
- A `FastAPI + SQLAlchemy` backend with PDF/image ingestion, page rendering, atomic page-layout persistence, and the later-phase segmentation/conversion pipeline scaffolding.

## Repo Layout

- `apps/frontend`: browser client
- `apps/backend`: Python API and processing pipeline
- `data/`: runtime storage for uploads, rendered pages, crops, and artifacts

## Local Development

### Both Services

```bash
npm install
npm run dev
```

This starts the frontend on `http://localhost:5173` and the backend on `http://localhost:8000` together.

For inspection from another machine on the same LAN, open the frontend using the dev machine's IP, for example `http://192.168.1.10:5173`. By default the frontend will target `http://<same-host>:8000/api`, and the backend accepts common private-network frontend origins.

For background management from the repo root:

```bash
npm run dev:start:bg
npm run dev:status
npm run dev:logs
npm run dev:stop
```

### Backend

```bash
cd apps/backend
cp .env.example .env
uv sync --dev
uv run onemoon-backend
```

The API runs on `http://localhost:8000` and serves artifacts under `/storage`.
For actual LLM-backed block conversion, either set `LLM_PROVIDER=openai` and `LLM_API_KEY` or `OPENAI_API_KEY` in `apps/backend/.env`, or keep credentials in the repo-root `.env` with `ONEMOON_LLM_PROVIDER`, `ONEMOON_LLM_MODEL`, and `ONEMOON_API_KEY`. If no real provider is configured, the backend falls back to mock text/math placeholders so the workflow still runs locally.

### Frontend

```bash
cd apps/frontend
cp .env.example .env
npm install
npm run dev
```

The frontend runs on `http://localhost:5173`.

## Default Credentials

- Username: `admin`
- Password: `onemoon`

Override them in `apps/backend/.env` before deploying anywhere outside local development.

## Verification

```bash
cd apps/backend && uv run pytest
cd apps/backend && uv run python -m compileall src
cd apps/frontend && npm run build
```
