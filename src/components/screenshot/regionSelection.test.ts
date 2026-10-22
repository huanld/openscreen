import { describe, expect, it } from "vitest";
import { regionFromDrag } from "./regionSelection";

describe("desktop region selection", () => {
	const viewport = { width: 1920, height: 1080 };
	it("returns normalized coordinates independently of screen DPI", () => {
		expect(regionFromDrag({ x: 192, y: 108 }, { x: 960, y: 540 }, viewport)).toEqual({
			x: 0.1,
			y: 0.1,
			width: 0.4,
			height: 0.4,
		});
	});
	it("supports dragging up and left", () => {
		expect(regionFromDrag({ x: 960, y: 540 }, { x: 192, y: 108 }, viewport)).toEqual({
			x: 0.1,
			y: 0.1,
			width: 0.4,
			height: 0.4,
		});
	});
	it("clamps a captured pointer outside the screen", () => {
		expect(regionFromDrag({ x: 192, y: 108 }, { x: 2400, y: 1500 }, viewport)).toEqual({
			x: 0.1,
			y: 0.1,
			width: 0.9,
			height: 0.9,
		});
	});
	it.each([
		[
			{ x: 300, y: 200 },
			{ x: 300, y: 200 },
		],
		[
			{ x: 300, y: 200 },
			{ x: 303, y: 400 },
		],
		[
			{ x: 300, y: 200 },
			{ x: 500, y: 202 },
		],
		[
			{ x: 300, y: 200 },
			{ x: 500, y: 200 },
		],
	])("does not capture a click or an accidental tiny selection", (start, end) => {
		expect(regionFromDrag(start, end, viewport)).toBeNull();
	});
	it("rejects unavailable geometry and non-finite positions", () => {
		expect(regionFromDrag({ x: 0, y: 0 }, { x: 200, y: 100 }, { width: 0, height: 0 })).toBeNull();
		expect(regionFromDrag({ x: Number.NaN, y: 0 }, { x: 200, y: 100 }, viewport)).toBeNull();
	});
	it("can preview a small drag without accepting it", () => {
		expect(regionFromDrag({ x: 0, y: 0 }, { x: 2, y: 2 }, viewport, 0)).not.toBeNull();
		expect(regionFromDrag({ x: 0, y: 0 }, { x: 2, y: 2 }, viewport)).toBeNull();
	});
});
