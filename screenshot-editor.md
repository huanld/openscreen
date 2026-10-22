# Screenshot capture and lightweight image editor

Project: Electron desktop application with React/TypeScript renderer.

Scope: open a dedicated screenshot workspace from the recorder HUD; capture a selected screen or window, crop to a region, edit with a GitHub open source canvas library, and save PNG/JPEG or copy PNG. Support opening an existing local image. Keep video recording intact.

- [x] Read local architecture, Knowledge MCP availability, and GitNexus capture flows.
- [x] Compare open source libraries and record license/source attribution.
- [x] Add screenshot native bridge contracts, capture/import/save/clipboard services, and a dedicated window.
- [x] Add capture picker and editor with crop, rotate, drawing, shapes, text, undo/redo.
- [x] Connect HUD and route, including English/Vietnamese strings and graceful error states.
- [x] Verify TypeScript/build, meaningful unit coverage, and Electron screenshot/edit/export smoke tests.

Completed 2026-09-16: production build passed; 249 unit tests, 3 Chromium raster tests, and the Electron end-to-end scenario passed. Real Windows screen/window capture also passed. See `docs/engineering/screenshot-editor.md` for usage and validation details.

Notes: Knowledge MCP has no OpenScreen architecture document yet. Existing local architecture says new native features use `native-bridge:invoke`. Git metadata was missing during implementation; it was recovered from Gitea main for the 1.4.14 release without replacing workspace source files. The GitNexus index predates the screenshot feature, so verify its references against current source.

## Direct region capture follow-up

User requests dragging a rectangle on the desktop before editing, with the development app left open for manual testing.

- [x] Add native region capture session, authorized selection overlay, physical-pixel crop and cancellation/window restoration.
- [x] Add a prominent Capture region button, frozen-screen drag rectangle, dimensions and Escape cancellation (English/Vietnamese).
- [x] Verify reverse drag, native pixel dimensions, tiny selections, cancel/restore, and successful handoff to the image editor.
- [x] Run development mode with hot reload and leave OpenScreen ready for manual testing.

Implementation uses the existing Electron capture and native bridge plus the integrated image editor. No additional library is needed for a rectangular selection overlay. Region capture targets one selected display, or the display nearest the pointer when no screen is selected.
