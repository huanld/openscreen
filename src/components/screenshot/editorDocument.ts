import Konva from "konva";

export type DrawingTool = "pen" | "rectangle" | "arrow" | "text" | "redact";
export type EditorTool = DrawingTool | "select" | "crop";
export type AnnotationOrder = "backward" | "forward" | "back" | "front";

export interface Annotation {
	id: string;
	kind: DrawingTool;
	x: number;
	y: number;
	rotation: number;
	color: string;
	strokeWidth: number;
	width: number;
	height: number;
	points: number[];
	text: string;
	fontSize: number;
}

export interface EditorDocument {
	id: string;
	dataUrl: string;
	width: number;
	height: number;
	annotations: Annotation[];
}

export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Bitmap strings are shared by annotation edits. Bound distinct bitmap history as well as steps. */
export function limitHistory(
	past: EditorDocument[],
	current: EditorDocument,
	byteBudget = 128 * 1024 * 1024,
) {
	const seen = new Set([current.dataUrl]);
	let bytes = current.dataUrl.length * 2;
	const retained: EditorDocument[] = [];
	for (let index = past.length - 1; index >= 0 && retained.length < 40; index--) {
		const previous = past[index];
		if (!seen.has(previous.dataUrl)) {
			bytes += previous.dataUrl.length * 2;
			if (bytes > byteBudget) break;
			seen.add(previous.dataUrl);
		}
		retained.unshift(previous);
	}
	return retained;
}

export function clampCrop(
	start: { x: number; y: number },
	end: { x: number; y: number },
	width: number,
	height: number,
): CropRect {
	const left = Math.max(0, Math.min(width - 1, Math.round(Math.min(start.x, end.x))));
	const top = Math.max(0, Math.min(height - 1, Math.round(Math.min(start.y, end.y))));
	const right = Math.max(left + 1, Math.min(width, Math.round(Math.max(start.x, end.x))));
	const bottom = Math.max(top + 1, Math.min(height, Math.round(Math.max(start.y, end.y))));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function cropAnnotations(annotations: Annotation[], crop: CropRect): Annotation[] {
	return annotations.map((annotation) => ({
		...annotation,
		x: annotation.x - crop.x,
		y: annotation.y - crop.y,
	}));
}

export function rotateAnnotations(annotations: Annotation[], oldHeight: number): Annotation[] {
	return annotations.map((annotation) => ({
		...annotation,
		x: oldHeight - annotation.y,
		y: annotation.x,
		rotation: normalizeRotation(annotation.rotation + 90),
	}));
}

/** Konva reports an unbounded signed angle; stored rotations stay within [0, 360). */
export function normalizeRotation(degrees: number): number {
	if (!Number.isFinite(degrees)) return 0;
	return ((degrees % 360) + 360) % 360;
}

/**
 * Applies a drag or rotate gesture to one annotation. Returns null when the
 * gesture left it exactly where it was, so the caller can skip the undo step
 * that a plain click on a shape would otherwise push onto the history.
 */
export function placeAnnotation(
	annotations: Annotation[],
	id: string,
	placement: { x: number; y: number; rotation: number },
): Annotation[] | null {
	const original = annotations.find((annotation) => annotation.id === id);
	if (!original) return null;
	const rotation = normalizeRotation(placement.rotation);
	if (original.x === placement.x && original.y === placement.y && original.rotation === rotation) {
		return null;
	}
	return annotations.map((annotation) =>
		annotation.id === id ? { ...annotation, x: placement.x, y: placement.y, rotation } : annotation,
	);
}

/** Duplicates one annotation directly above its source in paint order. */
export function duplicateAnnotation(
	annotations: Annotation[],
	id: string,
	newId: string,
	offset = 12,
): Annotation[] | null {
	const index = annotations.findIndex((annotation) => annotation.id === id);
	if (
		index < 0 ||
		!newId ||
		annotations.some((annotation) => annotation.id === newId) ||
		!Number.isFinite(offset)
	)
		return null;
	const source = annotations[index];
	const x = source.x + offset;
	const y = source.y + offset;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const duplicate: Annotation = {
		...source,
		id: newId,
		x,
		y,
		points: [...source.points],
	};
	return [...annotations.slice(0, index + 1), duplicate, ...annotations.slice(index + 1)];
}

/** Moves one annotation by a precise delta without mutating the current document. */
export function nudgeAnnotation(
	annotations: Annotation[],
	id: string,
	dx: number,
	dy: number,
): Annotation[] | null {
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
	const index = annotations.findIndex((annotation) => annotation.id === id);
	if (index < 0) return null;
	const source = annotations[index];
	const x = source.x + dx;
	const y = source.y + dy;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const next = [...annotations];
	next[index] = { ...source, x, y };
	return next;
}

/** Reorders one annotation in the array used as the canvas paint order. */
export function reorderAnnotation(
	annotations: Annotation[],
	id: string,
	direction: AnnotationOrder,
): Annotation[] | null {
	const index = annotations.findIndex((annotation) => annotation.id === id);
	if (index < 0) return null;
	const last = annotations.length - 1;
	const target =
		direction === "back"
			? 0
			: direction === "front"
				? last
				: direction === "backward"
					? index - 1
					: index + 1;
	if (target < 0 || target > last || target === index) return null;
	const next = [...annotations];
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved);
	return next;
}

export interface Point {
	x: number;
	y: number;
}

/** Konva node names that a press must not treat as "clicked empty canvas". */
export const ANNOTATION_NAME = "annotation";
export const ANNOTATION_HANDLE_NAME = "annotation-handle";

/**
 * Whether a press on this Konva node should clear the current selection. The
 * selection's own handles must be excluded: deselecting on pointer-down tears
 * the handle off the stage before its drag can start.
 */
export function clearsSelection(targetName: string): boolean {
	return targetName !== ANNOTATION_NAME && targetName !== ANNOTATION_HANDLE_NAME;
}

/** Below this the handles sit on top of each other and the angle is meaningless. */
const MIN_HANDLE_SPAN = 1;
const MIN_FONT_SIZE = 6;
const MIN_TRANSFORM_SCALE = 0.01;

/**
 * Vector from the annotation origin to its far handle, in the annotation's own
 * unrotated space. Only the rendered Konva node knows how wide a text run is,
 * so callers measure it and pass it in; the fallback keeps the handle far
 * enough away to stay draggable if the measurement is unavailable.
 */
function localSpan(annotation: Annotation, textSpan: number): Point {
	if (annotation.kind === "text") {
		return { x: Math.max(textSpan, annotation.fontSize, MIN_HANDLE_SPAN), y: 0 };
	}
	if (annotation.kind === "rectangle" || annotation.kind === "redact") {
		return { x: annotation.width, y: annotation.height };
	}
	const points = annotation.points;
	if (points.length < 4) return { x: MIN_HANDLE_SPAN, y: 0 };
	return {
		x: points[points.length - 2] - points[0],
		y: points[points.length - 1] - points[1],
	};
}

function rotatePoint(point: Point, degrees: number): Point {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * The two drag handles of an annotation: its origin and its far end. Dragging
 * either one both re-aims and rescales the annotation, so a single pair of
 * handles covers rotation and stretching.
 */
export function annotationHandles(
	annotation: Annotation,
	textSpan = 0,
): { start: Point; end: Point } {
	const span = rotatePoint(localSpan(annotation, textSpan), annotation.rotation);
	const start = { x: annotation.x, y: annotation.y };
	return { start, end: { x: start.x + span.x, y: start.y + span.y } };
}

/**
 * Re-aims and rescales an annotation so the dragged handle lands on `to` while
 * the opposite handle stays put. Stroke width is deliberately left alone: it is
 * a toolbar setting, not part of the shape's geometry.
 */
export function resizeAnnotation(
	annotation: Annotation,
	handle: "start" | "end",
	to: Point,
	textSpan = 0,
): Annotation {
	if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return annotation;
	const local = localSpan(annotation, textSpan);
	const baseLength = Math.hypot(local.x, local.y);
	if (baseLength < MIN_HANDLE_SPAN) return annotation;
	const handles = annotationHandles(annotation, textSpan);
	const start = handle === "end" ? handles.start : to;
	const end = handle === "end" ? to : handles.end;
	const vector = { x: end.x - start.x, y: end.y - start.y };
	const length = Math.hypot(vector.x, vector.y);
	if (length < MIN_HANDLE_SPAN) return annotation;
	const scale = length / baseLength;
	const rotation = normalizeRotation(
		((Math.atan2(vector.y, vector.x) - Math.atan2(local.y, local.x)) * 180) / Math.PI,
	);
	const next: Annotation = { ...annotation, x: start.x, y: start.y, rotation };
	if (annotation.kind === "text") {
		next.fontSize = Math.max(MIN_FONT_SIZE, annotation.fontSize * scale);
		return next;
	}
	if (annotation.kind === "rectangle" || annotation.kind === "redact") {
		next.width = annotation.width * scale;
		next.height = annotation.height * scale;
		return next;
	}
	next.points = annotation.points.map((value) => value * scale);
	return next;
}

/**
 * Commits a Konva-style transform into the annotation's stored geometry. Node
 * scale is deliberately not persisted: text remains uniformly sized, while
 * rectangular annotations and point paths absorb each axis independently.
 */
export function transformAnnotation(
	annotation: Annotation,
	transform: {
		x: number;
		y: number;
		rotation: number;
		scaleX: number;
		scaleY: number;
	},
): Annotation | null {
	const { x, y, rotation: rawRotation, scaleX, scaleY } = transform;
	if (
		![x, y, rawRotation, scaleX, scaleY].every(Number.isFinite) ||
		scaleX < MIN_TRANSFORM_SCALE ||
		scaleY < MIN_TRANSFORM_SCALE
	)
		return null;

	const rotation = normalizeRotation(rawRotation);
	const next: Annotation = { ...annotation, x, y, rotation };
	let geometryChanged = false;

	if (annotation.kind === "text") {
		const uniformScale = Math.min(scaleX, scaleY);
		const nextFontSize = annotation.fontSize * uniformScale;
		if (!Number.isFinite(nextFontSize) || nextFontSize < MIN_FONT_SIZE) return null;
		next.fontSize = nextFontSize;
		geometryChanged = nextFontSize !== annotation.fontSize;
	} else if (annotation.kind === "rectangle" || annotation.kind === "redact") {
		const width = annotation.width * scaleX;
		const height = annotation.height * scaleY;
		if (
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width < MIN_HANDLE_SPAN ||
			height < MIN_HANDLE_SPAN
		)
			return null;
		next.width = width;
		next.height = height;
		geometryChanged = width !== annotation.width || height !== annotation.height;
	} else {
		const points = annotation.points.map(
			(value, index) => value * (index % 2 === 0 ? scaleX : scaleY),
		);
		if (points.some((value) => !Number.isFinite(value))) return null;
		const xs = points.filter((_value, index) => index % 2 === 0);
		const ys = points.filter((_value, index) => index % 2 === 1);
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		if (!Number.isFinite(width) || !Number.isFinite(height) || Math.max(width, height) < 1)
			return null;
		next.points = points;
		geometryChanged = points.some((value, index) => value !== annotation.points[index]);
	}

	if (
		!geometryChanged &&
		x === annotation.x &&
		y === annotation.y &&
		rotation === annotation.rotation
	)
		return null;
	return next;
}

/** Clone only image content, omitting the selection/crop layer and preview scaling. */
export function exportImageCanvas(layer: Konva.Layer, width: number, height: number) {
	const stage = new Konva.Stage({ container: document.createElement("div"), width, height });
	try {
		stage.add(layer.clone({ listening: false }));
		stage.draw();
		return stage.toCanvas({ x: 0, y: 0, width, height, pixelRatio: 1 });
	} finally {
		stage.destroy();
	}
}

export function encodeImage(canvas: HTMLCanvasElement, format: "png" | "jpeg") {
	if (format === "png") return canvas.toDataURL("image/png");
	const background = document.createElement("canvas");
	background.width = canvas.width;
	background.height = canvas.height;
	const context = background.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable");
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, background.width, background.height);
	context.drawImage(canvas, 0, 0);
	return background.toDataURL("image/jpeg", 0.95);
}
