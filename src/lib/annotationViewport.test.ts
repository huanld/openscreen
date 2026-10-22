import { describe, expect, it } from "vitest";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import { mapAnnotationToViewport } from "./annotationViewport";

const annotation: AnnotationRegion = {
	id: "rectangle-1",
	startMs: 0,
	endMs: 1_000,
	type: "rectangle",
	content: "",
	position: { x: 25, y: 50 },
	size: { width: 20, height: 10 },
	style: { ...DEFAULT_ANNOTATION_STYLE },
	zIndex: 1,
};

describe("mapAnnotationToViewport", () => {
	it("keeps annotation geometry attached to a resized and moved video", () => {
		const mapped = mapAnnotationToViewport(
			annotation,
			{ x: 100, y: 50, width: 400, height: 200 },
			{ width: 1_000, height: 500 },
		);

		expect(mapped.position.x).toBe(20);
		expect(mapped.position.y).toBe(30);
		expect(mapped.size.width).toBe(8);
		expect(mapped.size.height).toBe(4);
	});

	it("preserves geometry for a full-canvas video", () => {
		const mapped = mapAnnotationToViewport(
			annotation,
			{ x: 0, y: 0, width: 1_000, height: 500 },
			{ width: 1_000, height: 500 },
		);

		expect(mapped.position).toEqual(annotation.position);
		expect(mapped.size).toEqual(annotation.size);
	});

	it("keeps text in canvas coordinates when the main video is resized", () => {
		const text = { ...annotation, id: "text-1", type: "text" as const };
		const mapped = mapAnnotationToViewport(
			text,
			{ x: 300, y: 150, width: 400, height: 200 },
			{ width: 1_000, height: 500 },
		);

		expect(mapped.position).toEqual(text.position);
		expect(mapped.size).toEqual(text.size);
	});
});
