import type { AnnotationSize } from "./types";

const DEFAULT_IMAGE_ANNOTATION_SIZE = 35;
const DEFAULT_IMAGE_ANNOTATION_DURATION_MS = 4_000;
const MIN_IMAGE_ANNOTATION_DURATION_MS = 1_500;

export function getImageAnnotationSize(
	naturalWidth: number,
	naturalHeight: number,
	maxDimension = DEFAULT_IMAGE_ANNOTATION_SIZE,
): AnnotationSize {
	if (
		!Number.isFinite(naturalWidth) ||
		!Number.isFinite(naturalHeight) ||
		naturalWidth <= 0 ||
		naturalHeight <= 0
	) {
		return { width: maxDimension, height: maxDimension };
	}

	const aspectRatio = naturalWidth / naturalHeight;
	return aspectRatio >= 1
		? { width: maxDimension, height: maxDimension / aspectRatio }
		: { width: maxDimension * aspectRatio, height: maxDimension };
}

export function getImageAnnotationTimeRange(
	currentTimeSeconds: number,
	durationSeconds: number,
): { startMs: number; endMs: number } {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return { startMs: 0, endMs: DEFAULT_IMAGE_ANNOTATION_DURATION_MS };
	}

	const totalDurationMs = Math.max(1, Math.round(durationSeconds * 1_000));
	const minimumDurationMs = Math.min(MIN_IMAGE_ANNOTATION_DURATION_MS, totalDurationMs);
	const requestedStartMs = Number.isFinite(currentTimeSeconds)
		? Math.round(currentTimeSeconds * 1_000)
		: 0;
	let startMs = Math.min(
		Math.max(0, requestedStartMs),
		Math.max(0, totalDurationMs - minimumDurationMs),
	);
	const endMs = Math.min(totalDurationMs, startMs + DEFAULT_IMAGE_ANNOTATION_DURATION_MS);
	if (endMs - startMs < minimumDurationMs) {
		startMs = Math.max(0, endMs - minimumDurationMs);
	}

	return { startMs, endMs };
}

export function loadImageAnnotationSize(dataUrl: string): Promise<AnnotationSize> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(getImageAnnotationSize(image.naturalWidth, image.naturalHeight));
		image.onerror = () =>
			resolve({
				width: DEFAULT_IMAGE_ANNOTATION_SIZE,
				height: DEFAULT_IMAGE_ANNOTATION_SIZE,
			});
		image.src = dataUrl;
	});
}
