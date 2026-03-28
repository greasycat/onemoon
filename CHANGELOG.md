# Changelog

- Added a collapse toggle ahead of the workspace block-list title and made collapsing preserve the panel's rounded-rectangle height instead of reflowing the canvas.

- Moved the workspace block list into the review canvas as an embedded overlay and removed the dedicated right-side panel so the canvas has more room.

- Renamed the workspace page-review side panel heading to `Block List`.

- Removed the workspace page-review summary cards for zoom level, layout version, and view mode so the side panel stays focused on block counts and the review list.

- Removed the block inspector source, shape, and confidence metadata cards so the panel stays focused on type and structure edits.

- Fixed polygon block double-click type changes to respect the real polygon hit area instead of the bounding box, so empty bbox space now targets the actual block under the cursor.

- Added a workspace debug hover indicator that shows which block the cursor is currently over inside the edit canvas.

- Added workspace block-type cycling on block double-click and surfaced a picker tip so reviewers can change types faster from the page or review list.

- Made workspace block-type changes apply immediately from the inspector select, so review no longer depends on a separate `Apply To Draft` click.

- Made the workspace `FIN` action save every dirty page draft before marking the active page finished, so review completion no longer depends on a separate manual save step.

- Centered the workspace loading state and added an animated spinner so large uploads show clear progress feedback while the review workspace initializes.

- Kept newly-uploaded workspace routes in a loading state while the backend creates the document and renders its first pages, instead of falling through to `Document not found.` during large uploads.

- Removed the dashboard upload side panel and moved upload actions into each workspace row so files can be sent to review directly beside the folder name.

- Moved the workspace top-bar `Back to projects` link below the app name so the brand stack reads title-first.

- Fixed frontend delete mutations by treating empty `204/205` API responses as successful, so document and project removals update the dashboard without a manual refresh.

- Fixed backend startup by making project/document delete routes explicit empty `204 No Content` responses that FastAPI accepts at import time.

- Rebuilt the projects dashboard into a tighter command-center layout with a modern hero, compact stats, clearer workspace selection, and an upload rail that still routes directly into the review workspace.

- Fixed the projects dashboard foreground/background contrast by scoping workspace-style warm surfaces, controls, and status colors to the dashboard without changing the workspace view.

- Documented the repo rule that each completed round of work should land in its own conventional commit.

- Tightened the workspace gap under the shared top bar and added a top-bar back link to return to the projects view.

- Prevented page overscroll chaining with contained workspace scrollers plus a document-level wheel/touch fallback, so hitting the end of a page no longer leaks into extra browser or parent-page scrolling.

- Merged the document editor header into a single top bar that only shows the project name and the source filename without its extension.

- Removed block-inspector merge/split actions and the manual approval pill buttons, and changed new/default block types to `text` instead of `unknown`.

- Moved the selected-block inspector into a canvas-right overlay so block information stays attached to the work surface while the side column focuses on page review.

- Removed the inspector panel bounding-box editor so block review focuses on type/approval and structural actions while geometry stays canvas-driven.

- Added a shared frontend debug flag so workspace debug controls now default to Vite dev mode and can be overridden with `VITE_FRONTEND_DEBUG=true|false`.

- Added review-workspace keyboard shortcuts for `Pick`, `Rect`, `Free`, `Cut`, `Save`, and `FIN`, plus modifier/range multi-selection with bulk block deletion.

- Fixed overlapping polygon hit-testing so a lower cut block's bounding box no longer steals pick clicks from the real polygon above it.

- Made pick-mode polygon selection respect the actual polygon shape instead of its bounding box, so clicks in the empty bbox area no longer select cut/free-form blocks.

- Made empty-page `Discard`, `Save`, and `FIN` toolbar clicks show a `Nothing is created.` toast instead of staying disabled with no feedback.

- Renamed the workspace segmented-action toolbar button from `Seg` to `FIN`.

- Reconstructed saved cut polygons into reusable cut ceilings on load so cut mode still stacks correctly after saving and refreshing the page.

- Fixed cut-mode deletion so removing the just-created cut block restores the previous remembered cut ceiling instead of leaving cut creation stuck on stale path state.

- Replaced the workspace glyph-based controls with `lucide-react` icons for the toolbar, theme toggle, debug launcher, and workspace back link.

- Kept the active draw tool selected after creating a block instead of auto-switching back to `Pick`.

- Remembered each page's last `Cut` stroke as the next cut ceiling, so consecutive cuts stack against the previous cut path instead of the page boundary.

- Lowered the default `Vertex merge tolerance` workspace debug setting from `0.003` to `0.002`.

- Changed `Cut` endpoint interpolation to use the raw deduped stroke instead of post-merge vertices when projecting to page boundaries.

- Removed the projected outline from the `Cut` tool preview so drawing only shows the raw stroke plus the filled upper region.

- Added a `Cut` canvas tool that turns an open stroke into a polygon block by extending its sampled endpoints to the page boundary and selecting the region above the cut.

- Regrouped the workspace canvas toolbar into page, block, zoom, and save sections with inline labels so the control rail scans more clearly.

- Fixed the workspace page sidebar so the selected page card keeps a visible active border and highlight state.

- Prevented the mobile canvas toolbar and helper tooltip from overflowing the review canvas by collapsing the overlay stack above the viewport on very small screens.

- Fixed the small-screen workspace layout so the review sidebar/canvas can shrink and the overlaid canvas toolbar wraps inside the canvas instead of overflowing it.
- Refactored the workspace page into a page-local state hook and tightened frontend form/focus accessibility so the upload-to-review flow is easier to maintain.
- Added a workspace-only floating debug toolbar with persisted free-form drawing thresholds and placeholder LLM controls for future request overrides.
- Refactored the workspace frontend so `WorkspacePage` delegates draft state and panel rendering to a page-specific controller hook and local side-panel components.
- Tightened the default free-form vertex merge tolerance in the workspace debug controls from `0.005` to `0.003`.
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
- Tightened the editor toolbar into a compact floating control tray so the workbench stays canvas-first.
- Moved the editor toolbar into a true top-left canvas overlay so it belongs to the review surface and preserves canvas interactions.
- Reworked the canvas toolbar into a slim vertical icon rail to reduce visual weight over the page.
- Split the canvas guidance copy out of the toolbar into a separate top-left floating tooltip so the icon rail stays compact.
- Added short labels and larger icons to the canvas toolbar buttons so the vertical rail scans faster.
- Loaded the workspace fonts from a third-party CDN so the editor typography is consistent across machines.
- Switched the workspace document title to a CDN-loaded monospace face for a cleaner editorial header.
- Returned the workspace document title to the Space Grotesk sans stack and removed the unused monospace CDN font.
- Switched the workspace `h2` headings to the same Space Grotesk sans stack as the document title.
- Removed the redundant page-count and workbench title headings from the review progress and editor panels.
- Removed the review-progress jump button so the sidebar summary is read-only.
- Tightened the review-progress stat cards so their labels wrap cleanly inside the sidebar without overflowing.
- Added a dedicated top inset in the canvas viewport so the floating tooltip no longer covers the page image.
- Increased region label contrast so the block-type badge text reads clearly against its chip background.
- Renamed the canvas draw-mode toolbar label to `Rect` to match the current rectangular drawing behavior.
- Removed the separate toolbar width control and switched the remaining page-fit button to a left-right arrow icon.
- Updated the toolbar button copy to the current short labels used in the canvas rail.
- Lowered the editor frame slightly by increasing the canvas top inset under the floating overlay.
- Disabled the native right-click context menu on the canvas surface.
- Fixed the active canvas tool styling so the selected toolbar button updates with a strong border and foreground state.
- Added save toasts in the workspace so the Save action now shows saving, success, and error feedback.
- Moved save toasts into the canvas top-right corner and disabled Save when a page has no blocks.
- Lowered the canvas toast so it no longer sits on top of the nearby status badges.
- Removed the block preview panel from the workspace side column.
- Removed the redundant `Layout Draft` heading from the page review panel.
- Added consistent internal spacing to the inspector panel so its sections are separated more clearly.
- Saved a browser-side localStorage backup on each layout save in addition to the backend request.
- Replaced the Pick icon with a cursor glyph and made empty-canvas clicks clear the current block selection.
- Fixed pick-mode viewport gutter clicks so empty space around the page also clears the current block selection.
- Added polygon-backed free-form block selection with self-intersection rejection, masked backend crops, and polygon-aware review editing.
- Increased free-form capture density while still merging nearly straight vertices after the stroke is complete.
- Reduced free-form merge aggressiveness slightly so completed strokes retain a few more vertices.
