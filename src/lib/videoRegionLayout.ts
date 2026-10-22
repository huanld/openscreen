import type {
	VideoRegion,
	VideoRegionAspectRatio,
	VideoRegionFitMode,
} from "@/components/video-editor/types";

export interface VideoRegionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface VideoRegionMediaLayout {
	source: VideoRegionRect;
	destination: VideoRegionRect;
	/** Full media element bounds, used by the clipped editor preview. */
	media: VideoRegionRect;
}

interface VideoRegionMediaLayoutInput {
	sourceWidth: number;
	sourceHeight: number;
	target: VideoRegionRect;
	fitMode?: VideoRegionFitMode;
	cropPosition?: { x: number; y: number };
	cropZoom?: number;
}

const FIXED_ASPECT_RATIOS: Partial<Record<VideoRegionAspectRatio, number>> = {
	"16:9": 16 / 9,
	"9:16": 9 / 16,
	"4:3": 4 / 3,
	"3:4": 3 / 4,
	"1:1": 1,
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function calculateVideoRegionMediaLayout({
	sourceWidth,
	sourceHeight,
	target,
	fitMode = "cover",
	cropPosition = { x: 50, y: 50 },
	cropZoom = 1,
}: VideoRegionMediaLayoutInput): VideoRegionMediaLayout | null {
	if (
		!Number.isFinite(sourceWidth) ||
		!Number.isFinite(sourceHeight) ||
		!Number.isFinite(target.width) ||
		!Number.isFinite(target.height) ||
		sourceWidth <= 0 ||
		sourceHeight <= 0 ||
		target.width <= 0 ||
		target.height <= 0
	) {
		return null;
	}

	const focusX = clamp(cropPosition.x, 0, 100) / 100;
	const focusY = clamp(cropPosition.y, 0, 100) / 100;

	if (fitMode === "contain") {
		const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
		const width = sourceWidth * scale;
		const height = sourceHeight * scale;
		const destination = {
			x: target.x + (target.width - width) * focusX,
			y: target.y + (target.height - height) * focusY,
			width,
			height,
		};
		return {
			source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
			destination,
			media: destination,
		};
	}

	const targetAspect = target.width / target.height;
	const sourceAspect = sourceWidth / sourceHeight;
	let cropWidth = sourceWidth;
	let cropHeight = sourceHeight;
	if (sourceAspect > targetAspect) {
		cropWidth = sourceHeight * targetAspect;
	} else {
		cropHeight = sourceWidth / targetAspect;
	}

	const zoom = clamp(cropZoom, 1, 4);
	cropWidth /= zoom;
	cropHeight /= zoom;
	const cropX = (sourceWidth - cropWidth) * focusX;
	const cropY = (sourceHeight - cropHeight) * focusY;
	const scale = target.width / cropWidth;

	return {
		source: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
		destination: { ...target },
		media: {
			x: target.x - cropX * scale,
			y: target.y - cropY * scale,
			width: sourceWidth * scale,
			height: sourceHeight * scale,
		},
	};
}

export function getVideoRegionAspectRatioValue(
	region: VideoRegion,
	preset: VideoRegionAspectRatio,
	canvasAspectRatio: number,
) {
	const fixed = FIXED_ASPECT_RATIOS[preset];
	if (fixed) return fixed;
	if (
		preset === "source" &&
		Number.isFinite(region.sourceWidth) &&
		Number.isFinite(region.sourceHeight) &&
		(region.sourceWidth ?? 0) > 0 &&
		(region.sourceHeight ?? 0) > 0
	) {
		return region.sourceWidth! / region.sourceHeight!;
	}
	return Math.max(0.01, (region.size.width * canvasAspectRatio) / region.size.height);
}

export function resizeVideoRegionToAspectRatio(
	region: VideoRegion,
	preset: VideoRegionAspectRatio,
	canvasAspectRatio: number,
): Pick<VideoRegion, "frameAspectRatio" | "position" | "size"> {
	if (preset === "free") {
		return {
			frameAspectRatio: preset,
			position: region.position,
			size: region.size,
		};
	}

	const desiredAspect = getVideoRegionAspectRatioValue(region, preset, canvasAspectRatio);
	let width = region.size.width;
	let height = (width * canvasAspectRatio) / desiredAspect;
	if (height > 100) {
		height = 100;
		width = (height * desiredAspect) / canvasAspectRatio;
	}
	width = clamp(width, 5, 100);
	height = clamp(height, 5, 100);

	const centerX = region.position.x + region.size.width / 2;
	const centerY = region.position.y + region.size.height / 2;
	return {
		frameAspectRatio: preset,
		size: { width, height },
		position: {
			x: clamp(centerX - width / 2, 0, 100 - width),
			y: clamp(centerY - height / 2, 0, 100 - height),
		},
	};
}
