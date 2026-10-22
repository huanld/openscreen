import type { AnnotationRegion } from "@/components/video-editor/types";

export interface AnnotationViewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AnnotationCanvasSize {
	width: number;
	height: number;
}

/** Text is a slide-level component; other annotations stay attached to the recording. */
export function isCanvasAnchoredAnnotation(annotation: AnnotationRegion) {
	return annotation.type === "text";
}

/**
 * Annotation geometry is stored in recording-video percentages. Convert it to
 * output-canvas percentages so preview effects and export stay attached to a
 * recording that has been resized or moved on the canvas.
 */
export function mapAnnotationToViewport(
	annotation: AnnotationRegion,
	viewport: AnnotationViewport,
	canvas: AnnotationCanvasSize,
): AnnotationRegion {
	if (isCanvasAnchoredAnnotation(annotation)) return annotation;
	if (canvas.width <= 0 || canvas.height <= 0) return annotation;

	return {
		...annotation,
		position: {
			x: ((viewport.x + (annotation.position.x / 100) * viewport.width) / canvas.width) * 100,
			y: ((viewport.y + (annotation.position.y / 100) * viewport.height) / canvas.height) * 100,
		},
		size: {
			width: ((annotation.size.width / 100) * viewport.width * 100) / canvas.width,
			height: ((annotation.size.height / 100) * viewport.height * 100) / canvas.height,
		},
	};
}

export function mapAnnotationsToViewport(
	annotations: readonly AnnotationRegion[],
	viewport: AnnotationViewport,
	canvas: AnnotationCanvasSize,
): AnnotationRegion[] {
	return annotations.map((annotation) => mapAnnotationToViewport(annotation, viewport, canvas));
}
