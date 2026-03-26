# Changelog

- Added the initial OneMoon full-stack scaffold with interactive block review, LaTeX assembly, and a Python ingestion pipeline.
- Added the Phase 1 manual-segmentation workflow with page drafts, atomic layout save, and page review state.
- Added a root dev runner so frontend and backend can be started together with one command.
- Added root scripts to start, inspect, tail logs for, restart, and stop the background dev stack.
- Fixed LAN development defaults so the frontend targets the current host and backend CORS accepts common private-network origins.
- Added a batchable Python script to index `assets/documents` into a two-column TSV manifest with placeholder descriptions.
- Fixed document upload so the frontend submits the active project correctly and the backend accepts `project_id` from multipart form data.
- Added a persisted light theme and theme switcher for the frontend login, project, and workspace flows.
- Expanded document editing mode with an editor toolbar, sticky draft actions, review progress summary, block preview card, and zoomable canvas viewport.
- Redesigned the document editor into a canvas-first workspace with a unified sticky control rail, lighter editorial styling, and less duplicated review chrome.
- Fixed document editor draw mode so dragging on the page image reaches the canvas and can start a new block.
