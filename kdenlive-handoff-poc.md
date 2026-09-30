# Kdenlive handoff

## Goal

Export a native Kdenlive project (`.kdenlive`, MLT XML) that any Kdenlive version opens directly, while keeping OpenScreen as the source of truth.

> Replaces the previous OpenTimelineIO (`.otio`) handoff: `.otio` import only shipped in Kdenlive 25.04 and dropped speed effects, while `.kdenlive` is the project format supported by every release.

## Scope

- [x] Generate a valid MLT XML document (`createKdenliveHandoff`) from the current recording.
- [x] Preserve cuts as editable playlist clips with in/out source frames.
- [x] Map speed regions to MLT `timewarp` producers (one per media/speed pair), so playback speed survives the handoff.
- [x] Include the optional webcam source as a separate video track above the screen track.
- [x] Export a dedicated audio track (`kdenlive:audio_track`) fed by a `mix` transition; video tracks composite via `qtblend`.
- [x] Export OpenScreen-only effects (zoom, annotations, blur) as `kdenlive:sequenceproperties.guides` JSON so the edit intent remains visible.
- [x] Use an atomic native-bridge save operation (`exportKdenliveProject`) with trusted source-path validation.
- [x] Expose the handoff from the Export panel with compatibility guidance.
- [x] Cover track/entry structure, timewarp mapping, guides, path normalization, and localization checks.

## Document structure (matched against Kdenlive sources/fixtures)

- Root `<mlt producer="main_bin" version="7.x">` with an `automatic` profile (dimensions from the source video, 60 fps).
- `kdenlive:docproperties.version = 1.04` so Kdenlive upgrades the flat layout silently; omitting it triggers an error dialog.
- Bin clips (`kdenlive:id` 1 = screen, 2 = webcam) in `main_bin` with `xml_retain=1`.
- MLT track order bottom-to-top: `black_track`, screen video, webcam video, screen audio (`hide="video"`).
- `global_feed="1"` marks the main tractor (modern Kdenlive identifies its main timeline this way).

## Non-goals

- Embed Kdenlive or MLT in OpenScreen.
- Recreate OpenScreen visual effects (zoom, annotations, blur) in Kdenlive — they are exported as guides only.
- Support round-trip import back into OpenScreen.

## Verification

- Unit tests for the MLT XML builder (`src/lib/kdenliveHandoff.test.ts`).
- TypeScript/Vite build.
- Relevant Vitest tests.
- i18n key parity.
- Open a generated fixture in Kdenlive (manual, any version ≥ 22.x).
