import { describe, expect, it } from "vitest";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
} from "@/components/video-editor/types";
import {
	getPreviewSourceScale,
	getRectangleSpotlightGeometry,
	getRectangleSpotlightSample,
	getRectangleSpotlightSourceResolution,
	hasActiveRectangleSpotlight,
	sortAnnotationsForSpotlight,
} from "./annotationSpotlight";

function annotation(
	id: string,
	type: AnnotationRegion["type"],
	startMs: number,
	endMs: number,
	zIndex: number,
): AnnotationRegion {
	return {
		id,
		startMs,
		endMs,
		type,
		content: "",
		position: DEFAULT_ANNOTATION_POSITION,
		size: DEFAULT_ANNOTATION_SIZE,
		style: DEFAULT_ANNOTATION_STYLE,
		zIndex,
	};
}

describe("rectangle spotlight timing and layers", () => {
	it("hides the cursor only while a rectangle is active", () => {
		const regions = [annotation("focus", "rectangle", 500, 1500, 10)];

		expect(hasActiveRectangleSpotlight(regions, 499)).toBe(false);
		expect(hasActiveRectangleSpotlight(regions, 500)).toBe(true);
		expect(hasActiveRectangleSpotlight(regions, 1499)).toBe(true);
		expect(hasActiveRectangleSpotlight(regions, 1500)).toBe(false);
	});

	it("renders every rectangle before text regardless of z-index", () => {
		const regions = [
			annotation("text", "text", 0, 1000, 1),
			annotation("arrow", "figure", 0, 1000, 4),
			annotation("focus", "rectangle", 0, 1000, 99),
		];

		expect(sortAnnotationsForSpotlight(regions).map(({ id }) => id)).toEqual([
			"focus",
			"arrow",
			"text",
		]);
	});

	it("uses the same inset geometry for every spotlight hole", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 10, y: 20 };
		focus.size = { width: 30, height: 40 };
		focus.figureData = { arrowDirection: "right", color: "#fff", strokeWidth: 4 };

		expect(getRectangleSpotlightGeometry(focus, 1000, 500)).toEqual({
			x: 110,
			y: 110,
			width: 280,
			height: 180,
			cornerRadius: 8,
		});
	});

	it("maps a high-DPI preview snapshot through the overlay CSS size", () => {
		expect(getPreviewSourceScale(1600, 1200, 800, 600, 1600, 1200)).toEqual({
			scaleX: 2,
			scaleY: 2,
		});
	});

	it("extracts only the native-resolution area that the spotlight magnifies", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 10, y: 20 };
		focus.size = { width: 30, height: 40 };
		focus.figureData = { arrowDirection: "right", color: "#fff", strokeWidth: 4 };

		expect(getRectangleSpotlightSample(focus, 1000, 500)).toEqual({
			x: 167.6470588235294,
			y: 147.05882352941177,
			width: 164.7058823529412,
			height: 105.88235294117648,
		});
		expect(getRectangleSpotlightSourceResolution(3840, 2160, 1280, 720)).toBe(3);
		expect(getRectangleSpotlightSourceResolution(1280, 720, 1920, 1080)).toBe(1.7);
		expect(getRectangleSpotlightSourceResolution(3840, 2160, 640, 360)).toBe(6);
	});

	it("lets rectangle focus geometry reach every video edge", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 0, y: 0 };
		focus.size = { width: 100, height: 100 };
		focus.figureData = { arrowDirection: "right", color: "#fff", strokeWidth: 4 };

		expect(getRectangleSpotlightGeometry(focus, 1000, 500)).toEqual({
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
			cornerRadius: 8,
		});
	});

	it("treats the resized video boundary as the spotlight edge", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 30, y: 30 };
		focus.size = { width: 40, height: 40 };
		focus.figureData = { arrowDirection: "right", color: "#fff", strokeWidth: 4 };

		expect(
			getRectangleSpotlightGeometry(focus, 1000, 500, 1, {
				x: 300,
				y: 150,
				width: 400,
				height: 200,
			}),
		).toEqual({
			x: 300,
			y: 150,
			width: 400,
			height: 200,
			cornerRadius: 8,
		});
	});

	it("clamps the zoom sample to the resized video instead of the full canvas", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 20, y: 20 };
		focus.size = { width: 10, height: 10 };

		const sample = getRectangleSpotlightSample(focus, 1000, 500, 1, {
			x: 300,
			y: 150,
			width: 400,
			height: 200,
		});

		expect(sample?.x).toBeGreaterThanOrEqual(300);
		expect(sample?.y).toBeGreaterThanOrEqual(150);
		expect((sample?.x ?? 0) + (sample?.width ?? 0)).toBeLessThanOrEqual(700);
		expect((sample?.y ?? 0) + (sample?.height ?? 0)).toBeLessThanOrEqual(350);
	});

	it("uses and bounds the zoom saved on each rectangle", () => {
		const focus = annotation("focus", "rectangle", 0, 1000, 1);
		focus.position = { x: 10, y: 20 };
		focus.size = { width: 30, height: 40 };
		focus.figureData = {
			arrowDirection: "right",
			color: "#fff",
			strokeWidth: 4,
			spotlightZoom: 2,
		};

		expect(getRectangleSpotlightSample(focus, 1000, 500)).toEqual({
			x: 180,
			y: 155,
			width: 140,
			height: 90,
		});
		expect(getRectangleSpotlightSourceResolution(1280, 720, 1920, 1080, 5)).toBe(5);

		focus.figureData.spotlightZoom = 99;
		expect(getRectangleSpotlightSample(focus, 1000, 500)?.width).toBe(56);
	});
});
