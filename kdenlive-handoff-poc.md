# Kdenlive handoff POC

## Goal

Add a safe, one-way OpenTimelineIO (`.otio`) export that Kdenlive can import while keeping OpenScreen as the source of truth.

## Scope

- [x] Generate a valid OTIO timeline from the current recording.
- [x] Preserve cuts as editable clips and map speed intent with OTIO metadata/effects and markers.
- [x] Include the optional webcam source as a separate video track.
- [x] Add timeline markers for OpenScreen-only effects so the edit intent remains visible.
- [x] Use an atomic native-bridge save operation with trusted source-path validation.
- [x] Expose the handoff from the Export panel with compatibility guidance.
- [x] Cover timeline conversion, path normalization, schema compatibility, and localization checks.

## Non-goals

- Embed Kdenlive or MLT in OpenScreen.
- Recreate OpenScreen visual effects in Kdenlive.
- Produce a native `.kdenlive` project.
- Support round-trip import back into OpenScreen.

## Verification

- Unit tests for the OTIO builder.
- TypeScript/Vite build.
- Relevant Vitest tests.
- i18n key parity.
- Parse a generated fixture with the official OpenTimelineIO library.
