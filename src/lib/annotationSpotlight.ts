import type { AnnotationRegion } from "@/components/video-editor/types";

export const RECTANGLE_SPOTLIGHT_DIM_COLOR = "rgba(2, 6, 23, 0.72)";
export const RECTANGLE_SPOTLIGHT_ZOOM = 1.7;
export const RECTANGLE_SPOTLIGHT_CLARITY_FILTER = "contrast(1.08)";

export interface RectangleSpotlightGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	cornerRadius: number;
}

export interface RectangleSpotlightSample {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RectangleSpotlightSource {
	canvas: CanvasImageSource;
	width: number;
	height: number;
}

export function getPreviewSourceScale(
	sourceWidth: number,
	sourceHeight: number,
	overlayWidth: number,
	overlayHeight: number,
	sourceClientWidth = 0,
	sourceClientHeight = 0,
): { scaleX: number; scaleY: number } | null {
	const displayWidth = overlayWidth > 0 ? overlayWidth : sourceClientWidth || sourceWidth;
	const displayHeight = overlayHeight > 0 ? overlayHeight : sourceClientHeight || sourceHeight;
	if (sourceWidth <= 0 || sourceHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
		return null;
	}
	return {
		scaleX: sourceWidth / displayWidth,
		scaleY: sourceHeight / displayHeight,
	};
}

export function getRectangleSpotlightGeometry(
	annotation: AnnotationRegion,
	canvasWidth: number,
	canvasHeight: number,
	scaleFactor = 1,
): RectangleSpotlightGeometry | null {
	if (annotation.type !== "rectangle") return null;
	const outerX = (annotation.position.x / 100) * canvasWidth;
	const outerY = (annotation.position.y / 100) * canvasHeight;
	const outerWidth = (annotation.size.width / 100) * canvasWidth;
	const outerHeight = (annotation.size.height / 100) * canvasHeight;
	const lineWidth = Math.max(1, (annotation.figureData?.strokeWidth || 4) * scaleFactor);
	const inset = 8 * scaleFactor + lineWidth / 2;
	const width = Math.max(0, outerWidth - inset * 2);
	const height = Math.max(0, outerHeight - inset * 2);
	if (width <= 0 || height <= 0) return null;

	return {
		x: outerX + inset,
		y: outerY + inset,
		width,
		height,
		cornerRadius: Math.min(8 * scaleFactor, width / 2, height / 2),
	};
}

export function getRectangleSpotlightSample(
	annotation: AnnotationRegion,
	canvasWidth: number,
	canvasHeight: number,
	scaleFactor = 1,
): RectangleSpotlightSample | null {
	const geometry = getRectangleSpotlightGeometry(
		annotation,
		canvasWidth,
		canvasHeight,
		scaleFactor,
	);
	if (!geometry) return null;

	const width = Math.min(canvasWidth, Math.max(1, geometry.width / RECTANGLE_SPOTLIGHT_ZOOM));
	const height = Math.min(canvasHeight, Math.max(1, geometry.height / RECTANGLE_SPOTLIGHT_ZOOM));
	const centerX = geometry.x + geometry.width / 2;
	const centerY = geometry.y + geometry.height / 2;

	return {
		x: Math.max(0, Math.min(canvasWidth - width, centerX - width / 2)),
		y: Math.max(0, Math.min(canvasHeight - height, centerY - height / 2)),
		width,
		height,
	};
}

/**
 * Resolution used when Pixi re-renders only the focused sample. It is high
 * enough to retain native recording pixels through the spotlight zoom, while
 * the cap prevents malformed media metadata from allocating an unbounded
 * render target.
 */
export function getRectangleSpotlightSourceResolution(
	sourceWidth: number,
	sourceHeight: number,
	canvasWidth: number,
	canvasHeight: number,
	minimumResolution = RECTANGLE_SPOTLIGHT_ZOOM,
): number {
	if (canvasWidth <= 0 || canvasHeight <= 0) return 1;
	const nativeResolution = Math.max(sourceWidth / canvasWidth, sourceHeight / canvasHeight, 1);
	return Math.min(8, Math.max(minimumResolution, nativeResolution));
}

export function hasActiveRectangleSpotlight(
	annotations: readonly AnnotationRegion[] | undefined,
	currentTimeMs: number,
): boolean {
	return Boolean(
		annotations?.some(
			(annotation) =>
				annotation.type === "rectangle" &&
				currentTimeMs >= annotation.startMs &&
				currentTimeMs < annotation.endMs,
		),
	);
}

function annotationLayerRank(annotation: AnnotationRegion): number {
	if (annotation.type === "rectangle") return 0;
	if (annotation.type === "text") return 2;
	return 1;
}

/**
 * Rectangle spotlights render first so their dimming layer never darkens text.
 * Text renders last and stays bright above the focused frame.
 */
export function sortAnnotationsForSpotlight(
	annotations: readonly AnnotationRegion[],
): AnnotationRegion[] {
	return [...annotations].sort((left, right) => {
		const layerDifference = annotationLayerRank(left) - annotationLayerRank(right);
		return layerDifference || left.zIndex - right.zIndex;
	});
}
