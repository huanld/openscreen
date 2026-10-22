import { describe, expect, it } from "vitest";
import type { VideoRegion } from "@/components/video-editor/types";
import {
	calculateVideoRegionMediaLayout,
	resizeVideoRegionToAspectRatio,
} from "./videoRegionLayout";

describe("videoRegionLayout", () => {
	it("fills a landscape frame with a portrait phone video without side bars", () => {
		const layout = calculateVideoRegionMediaLayout({
			sourceWidth: 1080,
			sourceHeight: 1920,
			target: { x: 10, y: 20, width: 160, height: 90 },
			fitMode: "cover",
			cropPosition: { x: 50, y: 50 },
		});

		expect(layout).not.toBeNull();
		expect(layout?.destination).toEqual({ x: 10, y: 20, width: 160, height: 90 });
		expect(layout?.source.width).toBeCloseTo(1080);
		expect(layout?.source.height).toBeCloseTo(607.5);
		expect(layout?.source.y).toBeCloseTo(656.25);
	});

	it("keeps the whole portrait video visible in contain mode", () => {
		const layout = calculateVideoRegionMediaLayout({
			sourceWidth: 1080,
			sourceHeight: 1920,
			target: { x: 0, y: 0, width: 160, height: 90 },
			fitMode: "contain",
		});

		expect(layout?.source).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
		expect(layout?.destination.width).toBeCloseTo(50.625);
		expect(layout?.destination.height).toBeCloseTo(90);
		expect(layout?.destination.x).toBeCloseTo(54.6875);
	});

	it("uses crop position and zoom to choose the visible source area", () => {
		const layout = calculateVideoRegionMediaLayout({
			sourceWidth: 1080,
			sourceHeight: 1920,
			target: { x: 0, y: 0, width: 160, height: 90 },
			fitMode: "cover",
			cropPosition: { x: 50, y: 0 },
			cropZoom: 2,
		});

		expect(layout?.source.y).toBe(0);
		expect(layout?.source.width).toBeCloseTo(540);
		expect(layout?.source.height).toBeCloseTo(303.75);
	});

	it("resizes the selected component to a preset while keeping it on canvas", () => {
		const region: VideoRegion = {
			id: "phone",
			startMs: 0,
			endMs: 1000,
			sourcePath: "phone.mp4",
			name: "phone.mp4",
			sourceDurationMs: 1000,
			sourceWidth: 1080,
			sourceHeight: 1920,
			position: { x: 50, y: 20 },
			size: { width: 36, height: 36 },
			zIndex: 1,
		};

		const resized = resizeVideoRegionToAspectRatio(region, "9:16", 16 / 9);
		const physicalAspect = (resized.size.width * (16 / 9)) / resized.size.height;
		expect(physicalAspect).toBeCloseTo(9 / 16);
		expect(resized.position.x + resized.size.width).toBeLessThanOrEqual(100);
		expect(resized.position.y + resized.size.height).toBeLessThanOrEqual(100);
	});
});
