# OneMoon Plan

## Summary
- Phase 1 is manual segmentation only.
- The page is the review unit.
- Conversion, assembly, and compile work stay secondary until manual segmentation is solid.

## Phase 1: Manual Segmentation
- Build a page-first review workflow with statuses: `unreviewed`, `in_review`, `segmented`.
- Make the canvas the primary editor:
  - draw new blocks
  - move blocks
  - resize from edges and corners
  - select and relabel blocks
  - reorder blocks
  - duplicate and delete blocks
  - merge with previous/next block
  - split horizontally or vertically
- Keep page edits local as a draft until the user explicitly saves.
- Add save/discard flow and dirty-page warnings.
- Add keyboard shortcuts: `Delete`, arrows, `Shift+arrows`, `Cmd/Ctrl+D`, `[`, `]`.
- Persist the whole page layout atomically through `PUT /api/pages/:id/layout`.

## Phase 2: Auto-Segmentation
- Keep the first auto-segmentation phase heuristic-based.
- Upgrade the current image-processing pipeline into an editable proposal generator.
- Preserve `figure` blocks and improve text/math grouping and ordering.
- Make auto-segmentation correction-friendly instead of autonomous.

## Phase 3: Conversion And Downstream
- Start conversion only after a page is marked `segmented`.
- Convert by block type: `text`, `math`, `figure`, `unknown`.
- Rebuild document LaTeX from converted pages.
- Keep compile/export after page conversion is working.

## API And Data Shape
- Add page review fields: `review_status`, `review_started_at`, `review_completed_at`, `layout_version`.
- Add block provenance fields: `source`, `parent_block_id`.
- Add page layout APIs:
  - `GET /api/pages/:id/layout`
  - `PUT /api/pages/:id/layout`
  - `POST /api/pages/:id/mark-segmented`
  - `POST /api/pages/:id/reopen`

## Acceptance
- A user can upload a document, open a page, manually define the full block layout, save it, reopen it later, and mark the page segmented.
- Manual edits do not trigger automatic conversion.
- Auto-segmentation and conversion remain later phases, not blockers for the manual workflow.
