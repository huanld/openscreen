import { describe, expect, it } from "vitest";
import {
	ANNOTATION_HANDLE_NAME,
	ANNOTATION_NAME,
	type Annotation,
	annotationHandles,
	clampCrop,
	clearsSelection,
	cropAnnotations,
	duplicateAnnotation,
	normalizeRotation,
	nudgeAnnotation,
	placeAnnotation,
	reorderAnnotation,
	resizeAnnotation,
	rotateAnnotations,
	transformAnnotation,
} from "./editorDocument";

const annotation: Annotation = {
	id: "arrow-1",
	kind: "arrow",
	x: 180,
	y: 120,
	rotation: 0,
	color: "#ef4444",
	strokeWidth: 4,
	width: 80,
	height: 40,
	points: [0, 0, 80, 40],
	text: "",
	fontSize: 24,
};

describe("screenshot crop selection", () => {
	it("supports drawing the crop from bottom-right to top-left", () => {
		expect(clampCrop({ x: 420, y: 270 }, { x: 100, y: 90 }, 640, 360)).toEqual({
			x: 100,
			y: 90,
			width: 320,
			height: 180,
		});
	});

	it("clips an overshooting drag to the image rather than adding empty pixels", () => {
		expect(clampCrop({ x: -100, y: -20 }, { x: 900, y: 400 }, 640, 360)).toEqual({
			x: 0,
			y: 0,
			width: 640,
			height: 360,
		});
	});

	it("keeps the final pixel selectable at the lower-right boundary", () => {
		expect(clampCrop({ x: 640, y: 360 }, { x: 900, y: 600 }, 640, 360)).toEqual({
			x: 639,
			y: 359,
			width: 1,
			height: 1,
		});
	});

	it("preserves annotation positions relative to the cropped image and leaves undo state intact", () => {
		const original = structuredClone(annotation);
		const [cropped] = cropAnnotations([annotation], { x: 100, y: 90, width: 320, height: 180 });
		expect({
			start: [cropped.x, cropped.y],
			end: [cropped.x + cropped.points[2], cropped.y + cropped.points[3]],
		}).toEqual({
			start: [80, 30],
			end: [160, 70],
		});
		expect(annotation).toEqual(original);
	});
});

describe("screenshot rotation", () => {
	it("rotates text and arrows around the image instead of their own centers", () => {
		const [rotated] = rotateAnnotations([annotation], 360);
		expect(rotated).toMatchObject({ x: 240, y: 180, rotation: 90, points: [0, 0, 80, 40] });
		expect(annotation).toMatchObject({ x: 180, y: 120, rotation: 0 });
	});

	it("returns all annotation geometry to its initial state after four quarter turns", () => {
		let annotations = [
			{ ...annotation, rotation: 270 },
			{ ...annotation, id: "text-1", kind: "text" as const, text: "Quarter turn" },
		];
		const initial = structuredClone(annotations);
		for (const imageHeight of [360, 640, 360, 640]) {
			annotations = rotateAnnotations(annotations, imageHeight);
		}
		expect(annotations).toEqual(initial);
	});
});

describe("annotation placement", () => {
	it("stores the angle and the origin that rotating moved the shape to", () => {
		const placed = placeAnnotation([annotation], "arrow-1", { x: 200, y: 140, rotation: 45 });
		expect(placed?.[0]).toMatchObject({ x: 200, y: 140, rotation: 45 });
	});

	it("turns a counter-clockwise drag into an equivalent positive angle", () => {
		const placed = placeAnnotation([annotation], "arrow-1", { x: 180, y: 120, rotation: -90 });
		expect(placed?.[0].rotation).toBe(270);
	});

	it("reports no change so a plain click does not push an undo step", () => {
		expect(placeAnnotation([annotation], "arrow-1", { x: 180, y: 120, rotation: 0 })).toBeNull();
		expect(placeAnnotation([annotation], "missing", { x: 10, y: 10, rotation: 10 })).toBeNull();
	});

	it("leaves the previous document intact so undo still restores it", () => {
		const original = structuredClone(annotation);
		placeAnnotation([annotation], "arrow-1", { x: 300, y: 300, rotation: 33 });
		expect(annotation).toEqual(original);
	});

	it("keeps a full turn and a rejected angle from corrupting stored rotation", () => {
		expect(normalizeRotation(360)).toBe(0);
		expect(normalizeRotation(-450)).toBe(270);
		expect(normalizeRotation(Number.NaN)).toBe(0);
	});
});

describe("professional annotation transforms", () => {
	it("scales text uniformly without stretching it and normalizes its rotation", () => {
		const label: Annotation = {
			...annotation,
			id: "text-1",
			kind: "text",
			text: "Uniform",
			fontSize: 24,
		};
		const original = structuredClone(label);
		const transformed = transformAnnotation(label, {
			x: 40,
			y: 55,
			rotation: -90,
			scaleX: 2,
			scaleY: 1.5,
		});

		expect(transformed).toMatchObject({ x: 40, y: 55, rotation: 270, fontSize: 36 });
		expect(transformed).not.toBe(label);
		expect(label).toEqual(original);
	});

	it.each(["rectangle", "redact"] as const)("resizes a %s independently on each axis", (kind) => {
		const box: Annotation = { ...annotation, kind, width: 80, height: 40 };
		const original = structuredClone(box);
		const transformed = transformAnnotation(box, {
			x: 200,
			y: 150,
			rotation: 400,
			scaleX: 1.5,
			scaleY: 2,
		});

		expect(transformed).toMatchObject({
			x: 200,
			y: 150,
			rotation: 40,
			width: 120,
			height: 80,
		});
		expect(box).toEqual(original);
	});

	it("absorbs each transform axis into every point of a pen stroke", () => {
		const stroke: Annotation = {
			...annotation,
			kind: "pen",
			points: [0, 0, 20, 10, 40, -5],
		};
		const original = structuredClone(stroke);
		const transformed = transformAnnotation(stroke, {
			x: stroke.x,
			y: stroke.y,
			rotation: 0,
			scaleX: 2,
			scaleY: 3,
		});

		expect(transformed?.points).toEqual([0, 0, 40, 30, 80, -15]);
		expect(transformed?.points).not.toBe(stroke.points);
		expect(stroke).toEqual(original);
	});

	it("returns null when the committed transform changes nothing", () => {
		expect(
			transformAnnotation(annotation, {
				x: annotation.x,
				y: annotation.y,
				rotation: annotation.rotation,
				scaleX: 1,
				scaleY: 1,
			}),
		).toBeNull();
	});

	it("rejects non-finite and collapsed transforms without touching the source", () => {
		const original = structuredClone(annotation);
		const valid = {
			x: annotation.x,
			y: annotation.y,
			rotation: annotation.rotation,
			scaleX: 1,
			scaleY: 1,
		};
		const invalid = [
			{ ...valid, x: Number.NaN },
			{ ...valid, y: Number.POSITIVE_INFINITY },
			{ ...valid, rotation: Number.NaN },
			{ ...valid, scaleX: 0 },
			{ ...valid, scaleX: -1 },
			{ ...valid, scaleY: 0.009 },
		];

		for (const transform of invalid) expect(transformAnnotation(annotation, transform)).toBeNull();
		expect(
			transformAnnotation({ ...annotation, kind: "text", fontSize: 6 }, { ...valid, scaleX: 0.5 }),
		).toBeNull();
		expect(
			transformAnnotation(
				{ ...annotation, kind: "rectangle", width: 1, height: 1 },
				{ ...valid, scaleX: 0.5 },
			),
		).toBeNull();
		expect(transformAnnotation({ ...annotation, points: [0, 0, 0.5, 0.5] }, valid)).toBeNull();
		expect(annotation).toEqual(original);
	});
});

describe("annotation duplication", () => {
	const annotations = [
		{ ...annotation, id: "back" },
		{ ...annotation, id: "source", x: 20, y: 30, points: [0, 0, 10, 20] },
		{ ...annotation, id: "front" },
	];

	it("inserts an independent clone immediately above its source", () => {
		const original = structuredClone(annotations);
		const duplicated = duplicateAnnotation(annotations, "source", "copy");

		expect(duplicated?.map(({ id }) => id)).toEqual(["back", "source", "copy", "front"]);
		expect(duplicated?.[2]).toMatchObject({ id: "copy", x: 32, y: 42 });
		expect(duplicated?.[2]).not.toBe(annotations[1]);
		expect(duplicated?.[2].points).not.toBe(annotations[1].points);
		expect(duplicated?.[0]).toBe(annotations[0]);
		expect(duplicated?.[1]).toBe(annotations[1]);
		expect(duplicated?.[3]).toBe(annotations[2]);
		expect(annotations).toEqual(original);
	});

	it("accepts an explicit offset, including zero", () => {
		expect(duplicateAnnotation(annotations, "source", "copy", 0)?.[2]).toMatchObject({
			x: 20,
			y: 30,
		});
		expect(duplicateAnnotation(annotations, "source", "copy", -5)?.[2]).toMatchObject({
			x: 15,
			y: 25,
		});
	});

	it("returns null for a missing source, invalid id, duplicate id, or invalid offset", () => {
		const original = structuredClone(annotations);
		expect(duplicateAnnotation(annotations, "missing", "copy")).toBeNull();
		expect(duplicateAnnotation(annotations, "source", "")).toBeNull();
		expect(duplicateAnnotation(annotations, "source", "front")).toBeNull();
		expect(duplicateAnnotation(annotations, "source", "copy", Number.NaN)).toBeNull();
		expect(annotations).toEqual(original);
	});
});

describe("annotation nudging", () => {
	it("moves only the requested annotation and leaves the input graph intact", () => {
		const annotations = [
			{ ...annotation, id: "first" },
			{ ...annotation, id: "selected", x: 10, y: 20 },
			{ ...annotation, id: "last" },
		];
		const original = structuredClone(annotations);
		const nudged = nudgeAnnotation(annotations, "selected", -3, 10);

		expect(nudged?.[1]).toMatchObject({ x: 7, y: 30 });
		expect(nudged).not.toBe(annotations);
		expect(nudged?.[0]).toBe(annotations[0]);
		expect(nudged?.[1]).not.toBe(annotations[1]);
		expect(nudged?.[2]).toBe(annotations[2]);
		expect(annotations).toEqual(original);
	});

	it("returns null for a missing target, zero delta, invalid delta, or overflow", () => {
		const annotations = [{ ...annotation, x: Number.MAX_VALUE }];
		const original = structuredClone(annotations);
		expect(nudgeAnnotation(annotations, "missing", 1, 1)).toBeNull();
		expect(nudgeAnnotation(annotations, annotation.id, 0, 0)).toBeNull();
		expect(nudgeAnnotation(annotations, annotation.id, Number.NaN, 1)).toBeNull();
		expect(nudgeAnnotation(annotations, annotation.id, Number.MAX_VALUE, 0)).toBeNull();
		expect(annotations).toEqual(original);
	});
});

describe("annotation paint order", () => {
	const annotations = [
		{ ...annotation, id: "back" },
		{ ...annotation, id: "middle" },
		{ ...annotation, id: "front" },
	];

	it.each([
		["middle", "backward", ["middle", "back", "front"]],
		["middle", "forward", ["back", "front", "middle"]],
		["front", "back", ["front", "back", "middle"]],
		["back", "front", ["middle", "front", "back"]],
	] as const)("moves %s %s while preserving object identity", (id, direction, expected) => {
		const original = structuredClone(annotations);
		const reordered = reorderAnnotation(annotations, id, direction);
		expect(reordered?.map((item) => item.id)).toEqual(expected);
		for (const item of annotations) expect(reordered).toContain(item);
		expect(annotations).toEqual(original);
	});

	it("returns null at every boundary and for an unknown annotation", () => {
		const original = structuredClone(annotations);
		expect(reorderAnnotation(annotations, "back", "backward")).toBeNull();
		expect(reorderAnnotation(annotations, "back", "back")).toBeNull();
		expect(reorderAnnotation(annotations, "front", "forward")).toBeNull();
		expect(reorderAnnotation(annotations, "front", "front")).toBeNull();
		expect(reorderAnnotation(annotations, "missing", "front")).toBeNull();
		expect(annotations).toEqual(original);
	});
});

describe("annotation handles", () => {
	it("puts the handles on the two ends of an arrow", () => {
		expect(annotationHandles(annotation)).toEqual({
			start: { x: 180, y: 120 },
			end: { x: 260, y: 160 },
		});
	});

	it("carries the end handle around with the annotation's own rotation", () => {
		const turned = annotationHandles({ ...annotation, rotation: 90 });
		expect(turned.start).toEqual({ x: 180, y: 120 });
		expect(turned.end.x).toBeCloseTo(140);
		expect(turned.end.y).toBeCloseTo(200);
	});

	it("drops the end handle exactly where the drag released it, keeping the start fixed", () => {
		const next = resizeAnnotation(annotation, "end", { x: 300, y: 300 });
		expect([next.x, next.y]).toEqual([180, 120]);
		const handles = annotationHandles(next);
		expect(handles.end.x).toBeCloseTo(300);
		expect(handles.end.y).toBeCloseTo(300);
	});

	it("pins the far end in place when the start handle is the one dragged", () => {
		const next = resizeAnnotation(annotation, "start", { x: 100, y: 100 });
		expect([next.x, next.y]).toEqual([100, 100]);
		const handles = annotationHandles(next);
		expect(handles.end.x).toBeCloseTo(260);
		expect(handles.end.y).toBeCloseTo(160);
	});

	it("stretches text by its font size rather than by a scale factor", () => {
		const label: Annotation = { ...annotation, kind: "text", x: 50, y: 50, text: "Hello" };
		const next = resizeAnnotation(label, "end", { x: 170, y: 50 }, 60);
		expect(next.fontSize).toBeCloseTo(48);
		expect(next.rotation).toBeCloseTo(0);
	});

	it("keeps a stretched rectangle's proportions while re-aiming its diagonal", () => {
		const box: Annotation = {
			...annotation,
			kind: "rectangle",
			x: 10,
			y: 20,
			width: 60,
			height: 80,
		};
		const next = resizeAnnotation(box, "end", { x: 10, y: 220 });
		expect([next.width, next.height]).toEqual([120, 160]);
		expect(next.rotation).toBeCloseTo(36.8699);
	});

	it("scales every point of a freehand stroke, not just its ends", () => {
		const stroke: Annotation = { ...annotation, kind: "pen", points: [0, 0, 20, 0, 40, 0] };
		const next = resizeAnnotation(stroke, "end", { x: 260, y: 120 }, 0);
		expect(next.points).toEqual([0, 0, 40, 0, 80, 0]);
	});

	it("refuses a drag that would collapse the two handles together", () => {
		expect(resizeAnnotation(annotation, "end", { x: 180, y: 120 })).toBe(annotation);
		expect(resizeAnnotation(annotation, "end", { x: Number.NaN, y: 0 })).toBe(annotation);
	});

	it("keeps stretched text legible instead of shrinking it to nothing", () => {
		const label: Annotation = { ...annotation, kind: "text", x: 50, y: 50, fontSize: 24 };
		const next = resizeAnnotation(label, "end", { x: 52, y: 50 }, 60);
		expect(next.fontSize).toBe(6);
	});

	it("leaves the annotation it was given untouched", () => {
		const original = structuredClone(annotation);
		resizeAnnotation(annotation, "end", { x: 500, y: 40 });
		expect(annotation).toEqual(original);
	});
});

describe("selection survival", () => {
	it("keeps the selection when the press lands on its shape or one of its handles", () => {
		expect(clearsSelection(ANNOTATION_NAME)).toBe(false);
		expect(clearsSelection(ANNOTATION_HANDLE_NAME)).toBe(false);
	});

	it("clears the selection for a press on empty canvas or any other node", () => {
		expect(clearsSelection("")).toBe(true);
		expect(clearsSelection("rotater")).toBe(true);
	});
});
