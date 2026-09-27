import type { WebcamLayoutPreset } from "@/lib/compositeLayout";
import {
	type AspectRatio,
	getAspectRatioValue,
	getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";

/**
 * Fill behind a video-only export. The recording covers the whole frame, so it
 * never shows; a solid colour also stops a missing wallpaper image from failing
 * an export that would not display it.
 */
export const VIDEO_ONLY_FILL = "#000000";

/** Webcam layouts that sit on top of the recording rather than beside it. */
const OVERLAY_WEBCAM_LAYOUTS: ReadonlySet<WebcamLayoutPreset> = new Set([
	"picture-in-picture",
	"no-webcam",
]);

export interface FramingStyle {
	wallpaper: string;
	padding: number;
	borderRadius: number;
	shadowIntensity: number;
	showBlur: boolean;
	webcamLayoutPreset: WebcamLayoutPreset;
}

/**
 * Removes everything that exists only to frame the recording, so the export is
 * the recording itself at its own size. Stacked and side-by-side webcam layouts
 * need a larger canvas with the background showing between the panes, so the
 * webcam falls back to a picture-in-picture overlay rather than being dropped.
 */
export function applyVideoOnlyFraming<T extends FramingStyle>(style: T): T {
	return {
		...style,
		wallpaper: VIDEO_ONLY_FILL,
		padding: 0,
		borderRadius: 0,
		shadowIntensity: 0,
		showBlur: false,
		webcamLayoutPreset: OVERLAY_WEBCAM_LAYOUTS.has(style.webcamLayoutPreset)
			? style.webcamLayoutPreset
			: "picture-in-picture",
	};
}

/**
 * Output aspect ratio. A video-only export always uses the recording's own shape
 * after cropping; any other aspect would letterbox it and bring the fill back.
 */
export function resolveExportAspectRatio({
	videoOnly,
	aspectRatio,
	sourceWidth,
	sourceHeight,
	cropRegion,
}: {
	videoOnly: boolean;
	aspectRatio: AspectRatio;
	sourceWidth: number;
	sourceHeight: number;
	cropRegion?: { x: number; y: number; width: number; height: number };
}): number {
	return videoOnly || aspectRatio === "native"
		? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
		: getAspectRatioValue(aspectRatio);
}
