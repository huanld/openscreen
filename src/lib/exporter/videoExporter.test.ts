import { describe, expect, it, vi } from "vitest";
import {
	ENCODER_PREFERENCES,
	getSourceCopyFastPathBlockers,
	isSourceCopyFastPathEligible,
	VideoExporter,
	type VideoExporterConfig,
} from "./videoExporter";

function createConfig(overrides: Partial<VideoExporterConfig> = {}): VideoExporterConfig {
	return {
		videoUrl: "recording.mp4",
		width: 1920,
		height: 1080,
		frameRate: 60,
		bitrate: 30_000_000,
		wallpaper: "#000000",
		zoomRegions: [],
		trimRegions: [],
		speedRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		showBlur: false,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		...overrides,
	};
}

describe("isSourceCopyFastPathEligible", () => {
	it("allows a no-op MP4 export at source dimensions", () => {
		expect(
			isSourceCopyFastPathEligible(createConfig(), {
				width: 1920,
				height: 1080,
			}),
		).toBe(true);
	});

	it("rejects timeline edits and frame-level effects", () => {
		const videoInfo = { width: 1920, height: 1080 };

		expect(
			isSourceCopyFastPathEligible(
				createConfig({ trimRegions: [{ id: "trim", startMs: 100, endMs: 200 }] }),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					speedRegions: [{ id: "speed", startMs: 100, endMs: 200, speed: 1.5 }],
				}),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					zoomRegions: [
						{
							id: "zoom",
							startMs: 100,
							endMs: 200,
							depth: 2,
							focus: { cx: 0.5, cy: 0.5 },
						},
					],
				}),
				videoInfo,
			),
		).toBe(false);
		expect(isSourceCopyFastPathEligible(createConfig({ showBlur: true }), videoInfo)).toBe(false);
	});

	it("rejects resizing and overlays", () => {
		const videoInfo = { width: 1920, height: 1080 };

		expect(isSourceCopyFastPathEligible(createConfig({ width: 1280 }), videoInfo)).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					cursorScale: 2,
				}),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					cursorScale: 2,
					cursorRecordingData: {
						version: 2,
						provider: "native",
						assets: [
							{
								id: "cursor",
								platform: "win32",
								imageDataUrl: "data:image/png;base64,AA==",
								width: 32,
								height: 32,
								hotspotX: 0,
								hotspotY: 0,
							},
						],
						samples: [{ timeMs: 0, cx: 0.5, cy: 0.5, visible: true, assetId: "cursor" }],
					},
				}),
				videoInfo,
			),
		).toBe(false);
	});

	it("rejects source-copy export when an added audio track must be mixed", () => {
		expect(
			getSourceCopyFastPathBlockers(
				createConfig({
					audioRegions: [
						{
							id: "audio-1",
							startMs: 0,
							endMs: 1000,
							sourceUrl: "file:///music/theme.mp3",
							volume: 1,
						},
					],
				}),
				{ width: 1920, height: 1080 },
			),
		).toContain("added audio tracks are present");
	});
});

describe("getSourceCopyFastPathBlockers", () => {
	it("reports the source-size mismatch that blocks copy-only export", () => {
		expect(
			getSourceCopyFastPathBlockers(createConfig({ height: 1080 }), {
				width: 1920,
				height: 1032,
			}),
		).toContain("output-size 1920x1080 differs from source 1920x1032");
	});
});

describe("encoder selection", () => {
	// exportWithEncoderPreference drives the real decoder, renderer and encoder;
	// these tests replace it to exercise only the retry policy around it.
	type Attempt = (preference: HardwareAcceleration) => Promise<unknown>;
	function exporterWith(attempt: Attempt) {
		const exporter = new VideoExporter(createConfig());
		const internals = exporter as unknown as {
			exportWithEncoderPreference: Attempt;
			cleanup: () => void;
		};
		internals.exportWithEncoderPreference = vi.fn(attempt);
		internals.cleanup = vi.fn();
		return {
			exporter,
			attempts: internals.exportWithEncoderPreference as ReturnType<typeof vi.fn>,
		};
	}

	it("tries the hardware encoder before software on every platform", () => {
		expect(ENCODER_PREFERENCES).toEqual(["prefer-hardware", "prefer-software"]);
	});

	it("uses hardware alone when it succeeds", async () => {
		const { exporter, attempts } = exporterWith(async () => ({ success: true }));
		await expect(exporter.export()).resolves.toEqual({ success: true });
		expect(attempts.mock.calls.map(([preference]) => preference)).toEqual(["prefer-hardware"]);
	});

	it("falls back to software when the hardware encoder fails or stalls", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { exporter, attempts } = exporterWith(async (preference) => {
			if (preference === "prefer-hardware") {
				throw new Error("The hardware video encoder stopped responding.");
			}
			return { success: true };
		});
		await expect(exporter.export()).resolves.toEqual({ success: true });
		expect(attempts.mock.calls.map(([preference]) => preference)).toEqual([
			"prefer-hardware",
			"prefer-software",
		]);
	});

	it("reports the last error when neither encoder can export", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { exporter } = exporterWith(async (preference) => {
			throw new Error(`${preference} unavailable`);
		});
		await expect(exporter.export()).resolves.toEqual({
			success: false,
			error: "prefer-software unavailable",
		});
	});
});
