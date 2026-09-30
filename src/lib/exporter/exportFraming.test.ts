import { describe, expect, it } from "vitest";
import {
	applyVideoOnlyFraming,
	type FramingStyle,
	resolveExportAspectRatio,
	VIDEO_ONLY_FILL,
} from "./exportFraming";
import {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
} from "./mp4ExportSettings";
import { getSourceCopyFastPathBlockers, type VideoExporterConfig } from "./videoExporter";

const composed: FramingStyle = {
	wallpaper: "/wallpapers/wallpaper4.jpg",
	padding: 40,
	borderRadius: 16,
	shadowIntensity: 0.6,
	showBlur: true,
	webcamLayoutPreset: "picture-in-picture",
};

describe("video-only export framing", () => {
	it("strips the wallpaper, padding, rounded corners, shadow and blur", () => {
		expect(applyVideoOnlyFraming(composed)).toEqual({
			wallpaper: VIDEO_ONLY_FILL,
			padding: 0,
			borderRadius: 0,
			shadowIntensity: 0,
			showBlur: false,
			webcamLayoutPreset: "picture-in-picture",
		});
	});

	it("keeps a webcam that already overlays the recording", () => {
		expect(
			applyVideoOnlyFraming({ ...composed, webcamLayoutPreset: "no-webcam" }).webcamLayoutPreset,
		).toBe("no-webcam");
	});

	it("turns side-by-side and stacked webcams into an overlay instead of dropping them", () => {
		for (const preset of ["dual-frame", "vertical-stack"] as const) {
			expect(
				applyVideoOnlyFraming({ ...composed, webcamLayoutPreset: preset }).webcamLayoutPreset,
			).toBe("picture-in-picture");
		}
	});

	it("carries unrelated settings through untouched", () => {
		const framed = applyVideoOnlyFraming({ ...composed, motionBlurAmount: 0.3 });
		expect(framed.motionBlurAmount).toBe(0.3);
		expect(composed.padding).toBe(40);
	});

	it("ignores the editor's aspect preset so the recording is never letterboxed", () => {
		const crop = { x: 0.1, y: 0, width: 0.5, height: 1 };
		expect(
			resolveExportAspectRatio({
				videoOnly: true,
				aspectRatio: "9:16",
				sourceWidth: 1920,
				sourceHeight: 1080,
				cropRegion: crop,
			}),
		).toBeCloseTo((1920 * 0.5) / 1080);
		expect(
			resolveExportAspectRatio({
				videoOnly: false,
				aspectRatio: "9:16",
				sourceWidth: 1920,
				sourceHeight: 1080,
				cropRegion: crop,
			}),
		).toBeCloseTo(9 / 16);
	});

	it("exports an unedited recording at source quality through the copy fast path", () => {
		const source = calculateEffectiveSourceDimensions(1920, 1080);
		const aspect = resolveExportAspectRatio({
			videoOnly: true,
			aspectRatio: "16:10",
			sourceWidth: 1920,
			sourceHeight: 1080,
		});
		const { width, height, bitrate } = calculateMp4ExportSettings({
			quality: "source",
			sourceWidth: source.width,
			sourceHeight: source.height,
			aspectRatioValue: aspect,
		});
		expect([width, height]).toEqual([1920, 1080]);

		const framed = applyVideoOnlyFraming(composed);
		const config: VideoExporterConfig = {
			videoUrl: "recording.mp4",
			width,
			height,
			frameRate: 60,
			bitrate,
			wallpaper: framed.wallpaper,
			zoomRegions: [],
			showShadow: framed.shadowIntensity > 0,
			shadowIntensity: framed.shadowIntensity,
			showBlur: framed.showBlur,
			borderRadius: framed.borderRadius,
			padding: framed.padding,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		};
		expect(getSourceCopyFastPathBlockers(config, { width: 1920, height: 1080 })).toEqual([]);
	});
});
