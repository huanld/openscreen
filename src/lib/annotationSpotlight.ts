import {
	type AnnotationRegion,
	DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM,
	MAX_RECTANGLE_SPOTLIGHT_ZOOM,
	MIN_RECTANGLE_SPOTLIGHT_ZOOM,
} from "@/components/video-editor/types";

export const RECTANGLE_SPOTLIGHT_DIM_COLOR = "rgba(2, 6, 23, 0.72)";
export const RECTANGLE_SPOTLIGHT_ZOOM = DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM;
export const RECTANGLE_SPOTLIGHT_CLARITY_FILTER = "contrast(1.08)";

export function clampRectangleSpotlightZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM;
	return Math.min(MAX_RECTANGLE_SPOTLIGHT_ZOOM, Math.max(MIN_RECTANGLE_SPOTLIGHT_ZOOM, zoom));
}

export function getRectangleSpotlightZoom(annotation: AnnotationRegion): number {
	return clampRectangleSpotlightZoom(
		annotation.figureData?.spotlightZoom ?? DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM,
	);
}

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

export interface RectangleSpotlightBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RectangleSpotlightInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface RectangleSpotlightSource {
	canvas: CanvasImageSource;
	width: number;
	height: number;
}

/**
 * Drops the decorative inset on any side touching the video boundary. This lets
 * a spotlight reach the true edge without storing negative annotation values.
 */
export function getRectangleSpotlightInsets(
	rect: { x: number; y: number; width: number; height: number },
	canvasWidth: number,
	canvasHeight: number,
	inset: number,
): RectangleSpotlightInsets {
	const edgeEpsilon = 0.5;
	return {
		top: rect.y <= edgeEpsilon ? 0 : inset,
		right: rect.x + rect.width >= canvasWidth - edgeEpsilon ? 0 : inset,
		bottom: rect.y + rect.height >= canvasHeight - edgeEpsilon ? 0 : inset,
		left: rect.x <= edgeEpsilon ? 0 : inset,
	};
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
	bounds?: RectangleSpotlightBounds,
): RectangleSpotlightGeometry | null {
	if (annotation.type !== "rectangle") return null;
	const outerX = (annotation.position.x / 100) * canvasWidth;
	const outerY = (annotation.position.y / 100) * canvasHeight;
	const outerWidth = (annotation.size.width / 100) * canvasWidth;
	const outerHeight = (annotation.size.height / 100) * canvasHeight;
	const lineWidth = Math.max(1, (annotation.figureData?.strokeWidth || 4) * scaleFactor);
	const inset = 8 * scaleFactor + lineWidth / 2;
	const geometryBounds = bounds ?? { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
	const insets = getRectangleSpotlightInsets(
		{
			x: outerX - geometryBounds.x,
			y: outerY - geometryBounds.y,
			width: outerWidth,
			height: outerHeight,
		},
		geometryBounds.width,
		geometryBounds.height,
		inset,
	);
	const width = Math.max(0, outerWidth - insets.left - insets.right);
	const height = Math.max(0, outerHeight - insets.top - insets.bottom);
	if (width <= 0 || height <= 0) return null;

	return {
		x: outerX + insets.left,
		y: outerY + insets.top,
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
	bounds?: RectangleSpotlightBounds,
): RectangleSpotlightSample | null {
	const geometry = getRectangleSpotlightGeometry(
		annotation,
		canvasWidth,
		canvasHeight,
		scaleFactor,
		bounds,
	);
	if (!geometry) return null;

	const zoom = getRectangleSpotlightZoom(annotation);
	const sampleBounds = bounds ?? { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
	const width = Math.min(sampleBounds.width, Math.max(1, geometry.width / zoom));
	const height = Math.min(sampleBounds.height, Math.max(1, geometry.height / zoom));
	const centerX = geometry.x + geometry.width / 2;
	const centerY = geometry.y + geometry.height / 2;

	return {
		x: Math.max(
			sampleBounds.x,
			Math.min(sampleBounds.x + sampleBounds.width - width, centerX - width / 2),
		),
		y: Math.max(
			sampleBounds.y,
			Math.min(sampleBounds.y + sampleBounds.height - height, centerY - height / 2),
		),
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
