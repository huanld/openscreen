import { describe, expect, it } from "vitest";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	type VideoRegion,
} from "@/components/video-editor/types";
import { getVideoCanvasSnapTargets } from "./videoCanvasSnapping";

const rectangle: AnnotationRegion = {
	id: "box",
	startMs: 0,
	endMs: 2_000,
	type: "rectangle",
	content: "",
	position: { x: 10, y: 20 },
	size: { width: 30, height: 40 },
	style: DEFAULT_ANNOTATION_STYLE,
	zIndex: 1,
};
const video: VideoRegion = {
	id: "clip",
	startMs: 0,
	endMs: 2_000,
	sourcePath: "clip.mp4",
	name: "clip",
	sourceDurationMs: 2_000,
	position: { x: 20, y: 30 },
	size: { width: 20, height: 20 },
	zIndex: 1,
};
const options = {
	width: 800,
	height: 450,
	timeMs: 1_000,
	isBlankSlide: false,
	mainVideo: { x: 100, y: 50, width: 600, height: 300 },
	webcam: null,
};

describe("video canvas snap targets", () => {
	it("converts recording-local shapes and canvas text into the same space", () => {
		const targets = getVideoCanvasSnapTargets({
			...options,
			annotations: [rectangle, { ...rectangle, id: "title", type: "text" }],
		});
		expect(targets.find((target) => target.id === "annotation:box")).toMatchObject({
			ownerId: "main-video",
			x: 160,
			y: 110,
			width: 180,
			height: 120,
		});
		expect(targets.find((target) => target.id === "annotation:title")).toMatchObject({
			x: 80,
			y: 90,
			width: 240,
			height: 180,
		});
	});
	it("excludes inactive elements but includes a selected element visible outside its interval", () => {
		const targets = getVideoCanvasSnapTargets({
			...options,
			timeMs: 2_000,
			annotations: [rectangle, { ...rectangle, id: "selected" }],
			videos: [video],
			selectedAnnotationId: "selected",
		});
		expect(targets.map((target) => target.id)).toEqual(["annotation:selected", "main-video"]);
	});
	it("includes supplemental video and webcam targets in canvas coordinates", () => {
		const targets = getVideoCanvasSnapTargets({
			...options,
			videos: [video],
			webcam: { x: 600, y: 300, width: 100, height: 90 },
		});
		expect(targets.find((target) => target.id === "video:clip")).toMatchObject({
			x: 160,
			y: 135,
			width: 160,
			height: 90,
		});
		expect(targets.find((target) => target.id === "webcam")).toMatchObject({
			x: 600,
			y: 300,
			width: 100,
			height: 90,
		});
	});
	it("uses the canvas for all slide elements and excludes hidden video layers", () => {
		const targets = getVideoCanvasSnapTargets({
			...options,
			isBlankSlide: true,
			annotations: [rectangle],
			videos: [video],
		});
		expect(targets).toEqual([
			{ id: "annotation:box", ownerId: undefined, x: 80, y: 90, width: 240, height: 180 },
		]);
	});
	it("uses rotated visual bounds and distinct ids for blur and ordinary annotations", () => {
		const targets = getVideoCanvasSnapTargets({
			...options,
			annotations: [{ ...rectangle, rotation: 90 }],
			blurs: [{ ...rectangle, type: "blur" }],
		});
		const rotated = targets.find((target) => target.id === "annotation:box");
		expect(rotated?.x).toBeCloseTo(190);
		expect(rotated?.y).toBeCloseTo(80);
		expect(rotated?.width).toBeCloseTo(120);
		expect(rotated?.height).toBeCloseTo(180);
		expect(targets.find((target) => target.id === "blur:box")).toMatchObject({
			x: 160,
			y: 110,
			width: 180,
			height: 120,
		});
	});
});
