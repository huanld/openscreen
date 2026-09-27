import Konva from "konva";
import { afterEach, describe, expect, it } from "vitest";
import {
	ANNOTATION_HANDLE_NAME,
	clearsSelection,
	encodeImage,
	exportImageCanvas,
} from "./editorDocument";

const stages: Konva.Stage[] = [];
afterEach(() => {
	for (const stage of stages.splice(0)) stage.destroy();
});

async function decode(dataUrl: string) {
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable.");
	context.drawImage(image, 0, 0);
	return context;
}

describe("screenshot raster export", () => {
	it("exports native pixels from a scaled preview without selection or crop overlays", () => {
		const stage = new Konva.Stage({
			container: document.createElement("div"),
			width: 160,
			height: 90,
			scaleX: 0.25,
			scaleY: 0.25,
		});
		stages.push(stage);
		const content = new Konva.Layer();
		content.add(new Konva.Rect({ width: 640, height: 360, fill: "white" }));
		content.add(new Konva.Rect({ x: 200, y: 100, width: 100, height: 80, fill: "red" }));
		const overlay = new Konva.Layer();
		overlay.add(new Konva.Rect({ width: 640, height: 360, fill: "blue" }));
		stage.add(content, overlay);
		stage.draw();

		const canvas = exportImageCanvas(content, 640, 360);
		const context = canvas.getContext("2d");
		expect([canvas.width, canvas.height]).toEqual([640, 360]);
		expect(Array.from(context!.getImageData(0, 0, 1, 1).data)).toEqual([255, 255, 255, 255]);
		expect(Array.from(context!.getImageData(250, 120, 1, 1).data)).toEqual([255, 0, 0, 255]);
		expect(content.getStage()).toBe(stage);
	});

	it("flattens transparency onto white when encoding JPEG", async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 20;
		canvas.height = 10;
		const context = await decode(encodeImage(canvas, "jpeg"));
		expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([255, 255, 255, 255]);
		expect([context.canvas.width, context.canvas.height]).toEqual([20, 10]);
	});

	it("preserves transparency when encoding PNG", async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 20;
		canvas.height = 10;
		const context = await decode(encodeImage(canvas, "png"));
		expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([0, 0, 0, 0]);
	});
});

describe("annotation rotation", () => {
	it("rotates a selected annotation that a grabbable overlay handle drives", () => {
		const stage = new Konva.Stage({
			container: document.createElement("div"),
			width: 640,
			height: 360,
		});
		stages.push(stage);
		const content = new Konva.Layer();
		content.add(new Konva.Rect({ width: 640, height: 360, fill: "white" }));
		// A wide, short bar: after a quarter turn it can only cover pixels that
		// the unrotated bar never reaches, so the assertions cannot pass by luck.
		const bar = new Konva.Rect({
			id: "bar",
			x: 200,
			y: 100,
			width: 120,
			height: 20,
			fill: "red",
		});
		content.add(bar);
		// The editor keeps its selection UI on a separate overlay layer so exports
		// exclude it; this is the arrangement the endpoint handles work in.
		const overlay = new Konva.Layer();
		const handle = new Konva.Circle({
			name: ANNOTATION_HANDLE_NAME,
			x: 320,
			y: 110,
			radius: 8,
			fill: "white",
			stroke: "green",
			draggable: true,
		});
		overlay.add(handle);
		stage.add(content, overlay);
		stage.draw();

		// A handle is useless unless it receives pointer events, which an overlay
		// layer marked listening={false} silently takes away, and unless a press on
		// it leaves the selection standing.
		expect(handle.isListening()).toBe(true);
		expect(stage.getIntersection(handle.getAbsolutePosition())).toBe(handle);
		expect(clearsSelection(handle.name())).toBe(false);

		bar.rotation(90);
		stage.draw();
		const canvas = exportImageCanvas(content, 640, 360);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable.");
		// Rotation turns about the node origin: local +x becomes screen +y, so the
		// bar now spans x 180-200, y 100-220 and has left the pixels to its right.
		expect(Array.from(context.getImageData(190, 200, 1, 1).data)).toEqual([255, 0, 0, 255]);
		expect(Array.from(context.getImageData(300, 110, 1, 1).data)).toEqual([255, 255, 255, 255]);
	});
});
