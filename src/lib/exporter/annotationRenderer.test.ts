import { describe, expect, it, vi } from "vitest";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
} from "@/components/video-editor/types";
import { renderAnnotations } from "./annotationRenderer";

function createContextMock() {
	return {
		beginPath: vi.fn(),
		canvas: {} as HTMLCanvasElement,
		clip: vi.fn(),
		drawImage: vi.fn(),
		fill: vi.fn(),
		fillStyle: "",
		lineJoin: "",
		lineWidth: 0,
		rect: vi.fn(),
		restore: vi.fn(),
		roundRect: vi.fn(),
		save: vi.fn(),
		shadowBlur: 0,
		shadowColor: "",
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		stroke: vi.fn(),
		strokeStyle: "",
	};
}

function createRectangle(): AnnotationRegion {
	return {
		id: "spotlight",
		startMs: 500,
		endMs: 1500,
		type: "rectangle",
		content: "",
		position: { x: 10, y: 20 },
		size: { width: 30, height: 40 },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: 1,
		figureData: { ...DEFAULT_FIGURE_DATA, color: "#facc15", strokeWidth: 4 },
	};
}

describe("renderAnnotations rectangle spotlight", () => {
	it("dims the frame once and keeps every simultaneous rectangle focused", async () => {
		const context = createContextMock();
		const maskOperations: string[] = [];
		const maskContext = {
			beginPath: vi.fn(),
			clearRect: vi.fn(),
			fill: vi.fn(),
			fillRect: vi.fn(),
			fillStyle: "",
			roundRect: vi.fn(),
		};
		Object.defineProperty(maskContext, "globalCompositeOperation", {
			get: () => maskOperations.at(-1) ?? "source-over",
			set: (value: string) => maskOperations.push(value),
		});
		const maskCanvas = {
			getContext: vi.fn(() => maskContext),
			height: 0,
			width: 0,
		};
		const spotlightContext = {
			clearRect: vi.fn(),
			drawImage: vi.fn(),
			filter: "none",
			imageSmoothingEnabled: false,
			imageSmoothingQuality: "low",
		};
		const spotlightCanvas = {
			getContext: vi.fn(() => spotlightContext),
			height: 0,
			width: 0,
		};
		const createElement = vi
			.spyOn(document, "createElement")
			.mockReturnValueOnce(maskCanvas as unknown as HTMLCanvasElement)
			.mockReturnValueOnce(spotlightCanvas as unknown as HTMLCanvasElement);
		const secondRectangle = {
			...createRectangle(),
			id: "spotlight-2",
			position: { x: 50, y: 10 },
			size: { width: 20, height: 30 },
			zIndex: 2,
		};
		const nativeSpotlightCanvas = {} as CanvasImageSource;
		const nativeSpotlightSources = new Map([
			["spotlight", { canvas: nativeSpotlightCanvas, width: 560, height: 360 }],
		]);

		await renderAnnotations(
			context as unknown as CanvasRenderingContext2D,
			[createRectangle(), secondRectangle],
			1000,
			500,
			1000,
			1,
			nativeSpotlightSources,
		);

		expect(maskContext.fillRect).toHaveBeenCalledOnce();
		expect(maskContext.fillStyle).toBe("rgba(2, 6, 23, 0.72)");
		expect(maskContext.roundRect).toHaveBeenCalledWith(110, 110, 280, 180, 8);
		expect(maskContext.roundRect).toHaveBeenCalledWith(510, 60, 180, 130, 8);
		expect(maskContext.fill).toHaveBeenCalledTimes(2);
		expect(maskOperations).toEqual(["source-over", "destination-out", "source-over"]);
		expect(context.drawImage).toHaveBeenCalledWith(maskCanvas, 0, 0);
		expect(spotlightContext.drawImage).toHaveBeenCalledTimes(2);
		expect(spotlightContext.drawImage.mock.calls[0]).toEqual([
			nativeSpotlightCanvas,
			0,
			0,
			560,
			360,
			0,
			0,
			280,
			180,
		]);
		const fallbackSample = spotlightContext.drawImage.mock.calls[1];
		expect(fallbackSample[3]).toBeCloseTo(180 / 1.7);
		expect(fallbackSample[4]).toBeCloseTo(130 / 1.7);
		expect(spotlightContext.filter).toBe("none");
		expect(context.drawImage).toHaveBeenCalledWith(spotlightCanvas, 110, 110, 280, 180);
		expect(context.drawImage).toHaveBeenCalledWith(spotlightCanvas, 510, 60, 180, 130);
		expect(context.stroke).toHaveBeenCalledTimes(2);
		createElement.mockRestore();
	});

	it("does not render the spotlight outside its timeline range", async () => {
		const context = createContextMock();

		await renderAnnotations(
			context as unknown as CanvasRenderingContext2D,
			[createRectangle()],
			1000,
			500,
			1600,
			1,
		);

		expect(context.fill).not.toHaveBeenCalled();
		expect(context.stroke).not.toHaveBeenCalled();
	});
});
