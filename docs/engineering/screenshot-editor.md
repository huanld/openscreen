# Screenshot capture and image editing

Open the camera button on the recorder HUD, or **File → Screenshot & image editor** (`Ctrl/Cmd+Shift+P` while OpenScreen is focused). Click **Capture region**, drag a rectangle over the desktop, and release to edit only that region. Dragging in either direction works; **Esc** cancels. If a screen is selected, region capture uses that display; otherwise it uses the display nearest the pointer. A region stays within one display.

To capture a complete screen or another app's window, select its thumbnail and use **Capture & edit**. OpenScreen temporarily hides its own visible windows during capture and region selection, then restores them after completion, cancellation or failure. Existing PNG/JPEG files can also be opened.

The dedicated image workspace leaves the video editor and its project intact. Edits run locally: crop, quarter-turn rotation, freehand pen, rectangle, arrow, text, opaque redaction, and undo/redo. Export PNG/JPEG or copy an image to the system clipboard. Export uses image pixel coordinates, independently of the preview fit scale.

## Open source integration

- [Konva](https://github.com/konvajs/konva), pinned to `10.5.0`, MIT: canvas rendering and image export.
- [react-konva](https://github.com/konvajs/react-konva), pinned to `18.2.16`, MIT: React 18 bindings. The React 19 adapter is not used.
- License texts are included under `public/licenses/` and ship with the renderer assets.

Konva was selected for its small, dependency-free core and compatibility with the existing React UI. Fabric was considered but brings optional Node canvas dependencies. TOAST UI was considered but its published editor uses an older Fabric version and defaults to usage analytics. The integrated editor uses npm modules and has no upload service, CDN, or analytics.

## Architecture

- `src/components/screenshot/ScreenshotWorkspace.tsx`: capture source picker and native I/O integration.
- `src/components/screenshot/ScreenshotRegionOverlay.tsx`: frozen-screen rectangle selection before editing.
- `src/components/screenshot/ImageEditor.tsx`: local image editing UI, lazy-loaded with the screenshot route.
- `src/native/contracts.ts` and `src/native/client.ts`: typed screenshot domain on the existing native bridge.
- `electron/native-bridge/services/screenshotService.ts`: capture, validated image import/export, clipboard, and dialog handling.
- `electron/windows.ts`: independent reusable screenshot window.

Screen images request the display's physical pixel dimensions including its scale factor. Region selection sends normalized coordinates through the native bridge; the main process crops the captured image at its original pixel resolution. Selection data and completion are restricted to the active overlay window. Electron controls the actual image resolution returned by the OS for window thumbnails; the editor reports and exports those actual dimensions. Protected/minimized windows and platform capture permissions can prevent capture. No OS-global screenshot shortcut or scrolling capture is added.

New image-editor strings are supplied in English and Vietnamese; other existing locales use English text for this feature until translated.

## Verification (Windows, 2026-09-16)

- `npm run build-vite`: TypeScript and production renderer/main/preload builds passed.
- `npm test -- --reporter=dot`: 36 files / 249 tests passed.
- `npm run test:browser -- src/components/screenshot/editorDocument.browser.test.ts`: 3 raster tests passed using real Chromium; verifies native-size export, omission of selection overlay, PNG transparency and JPEG background.
- `npx playwright test tests/e2e/screenshot-editor.spec.ts --workers=1`: passed. Covers Electron import/edit/export, pixel equality after undo, crop dimensions/rotation, Ctrl+Z/Ctrl+Shift+Z/Ctrl+S, native Save menu routing, and native close/keep/discard without closing the HUD. Uses native image encoding, isolated profile, fixture images and substituted OS dialogs; clipboard payload is checked without overwriting the user's clipboard.
- Desktop smoke: real screen capture returned 1920×1080 and matched the display's physical resolution and decoded PNG size; a real external window capture also succeeded.
- Targeted Biome validation, `biome lint src electron tests scripts`, and translation key parity passed. Repository-wide `biome check` still reports pre-existing formatting errors in files outside this change; no broad lint cleanup was undertaken.
- No Windows installer or release upload is included in this change.

Region capture follow-up: all 278 unit tests across 38 files passed, including normalized coordinate conversion, high DPI crop bounds, sender authorization, origin/overlay cancellation and selection cleanup. Two Electron region scenarios passed against the development renderer: default screen capture without selecting a source first, explicit screen selection, forward/reverse drag with exact exported bitmap comparison, full display content bounds, tiny-click rejection, Escape and Cancel restoring the visible workspace. A separate real desktop smoke captured 1920×1080 and cropped the center to 960×540 with exact pixel equality. TypeScript, source lint and locale key parity passed. The region overlay preview was also visually inspected.
