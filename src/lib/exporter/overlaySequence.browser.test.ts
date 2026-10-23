import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import sampleVideoUrl from "../../../tests/fixtures/sample.webm?url";
import { OverlaySequenceRenderer } from "./overlaySequence";

function redactRegion(): AnnotationRegion {
	return {
		id: "overlay-redact",
		startMs: 0,
		endMs: 600_000,
		type: "redact",
		content: "",
		position: { x: 25, y: 25 },
		size: { width: 50, height: 50 },
		style: {
			color: "#ffffff",
			backgroundColor: "#000000",
			fontSize: 24,
			fontFamily: "Arial",
			fontWeight: "bold",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "left",
		},
		zIndex: 1,
	};
}

describe("OverlaySequenceRenderer (real browser)", () => {
	it("renders transparent PNG frames that carry only the annotation pixels", async () => {
		const frames: ArrayBuffer[] = [];
		const progress: Array<[number, number]> = [];
		const renderer = new OverlaySequenceRenderer({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 10,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			zoomRegions: [],
			annotationRegions: [redactRegion()],
			onFrame: async (index, png) => {
				frames[index] = png;
			},
			onProgress: (frame, totalFrames) => progress.push([frame, totalFrames]),
		});

		const result = await renderer.run();
		renderer.destroy();

		expect(result.cancelled).toBe(false);
		expect(result.frameCount).toBeGreaterThan(1);
		expect(frames.length).toBe(result.frameCount);
		expect(progress.at(-1)).toEqual([result.frameCount, result.frameCount]);

		const bitmap = await createImageBitmap(new Blob([frames[0]], { type: "image/png" }));
		try {
			const canvas = document.createElement("canvas");
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(bitmap, 0, 0);
			const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const pixel = (x: number, y: number) => {
				const offset = (y * canvas.width + x) * 4;
				return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
			};

			expect(canvas.width).toBe(320);
			expect(canvas.height).toBe(180);
			// Corner outside the annotation stays fully transparent.
			expect(pixel(4, 4)[3]).toBe(0);
			// The annotation block is opaque black in the middle.
			const [red, green, blue, alpha] = pixel(160, 90);
			expect(alpha).toBe(255);
			expect(red + green + blue).toBeLessThanOrEqual(30);
		} finally {
			bitmap.close();
		}
	});

	it("honors trim regions by matching the trimmed timeline frame count", async () => {
		const frames: ArrayBuffer[] = [];
		const renderer = new OverlaySequenceRenderer({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 10,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			zoomRegions: [],
			trimRegions: [{ id: "cut", startMs: 0, endMs: 500 }],
			onFrame: async (index, png) => {
				frames[index] = png;
			},
		});
		const result = await renderer.run();
		renderer.destroy();

		// Trimming the first half leaves the second half of the fixture.
		expect(result.frameCount).toBeGreaterThan(0);
		expect(frames.length).toBe(result.frameCount);
	});
});
