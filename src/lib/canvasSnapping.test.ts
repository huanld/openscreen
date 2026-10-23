import { describe, expect, it } from "vitest";
import { getRotatedCanvasRect, snapCanvasRect } from "./canvasSnapping";

const frame = { x: 0, y: 0, width: 800, height: 450 };

describe("canvas alignment snapping", () => {
	it("aligns both axes to the frame center and draws full-frame guides", () => {
		const result = snapCanvasRect({ frame, rect: { x: 347, y: 178, width: 100, height: 100 } });
		expect(result).toEqual({
			x: 350,
			y: 175,
			guides: [
				{ axis: "x", position: 400, start: 0, end: 450 },
				{ axis: "y", position: 225, start: 0, end: 800 },
			],
		});
	});
	it.each([
		[3, 4, 0, 0],
		[697, 4, 700, 0],
		[3, 347, 0, 350],
		[697, 347, 700, 350],
	])("snaps (%s, %s) to the nearest frame corner", (x, y, expectedX, expectedY) => {
		expect(snapCanvasRect({ frame, rect: { x, y, width: 100, height: 100 } })).toMatchObject({
			x: expectedX,
			y: expectedY,
		});
	});
	it("aligns edges and centers to another element, outside the frame anchors", () => {
		const targets = [{ id: "other", x: 123, y: 83, width: 80, height: 70 }];
		expect(
			snapCanvasRect({ frame, targets, rect: { x: 206, y: 115, width: 40, height: 60 } }),
		).toMatchObject({ x: 203, y: 118 });
	});
	it("chooses the nearest element even when a frame guide is also nearby", () => {
		const targets = [{ x: 6, y: 80, width: 20, height: 30 }];
		expect(
			snapCanvasRect({ frame, targets, rect: { x: 4, y: 73, width: 300, height: 40 } }).x,
		).toBe(6);
	});
	it("does not align an element to itself or to its attached children", () => {
		const rect = { id: "moving", x: 111, y: 72, width: 80, height: 40 };
		expect(
			snapCanvasRect({
				frame,
				rect,
				targets: [rect, { x: 112, y: 73, width: 80, height: 40, ownerId: "moving" }],
			}),
		).toEqual({ x: 111, y: 72, guides: [] });
	});
	it("leaves positions outside the threshold alone", () => {
		expect(snapCanvasRect({ frame, rect: { x: 343, y: 168, width: 100, height: 100 } })).toEqual({
			x: 343,
			y: 168,
			guides: [],
		});
	});
	it("allows Alt to bypass snapping and remove all guides", () => {
		expect(
			snapCanvasRect({ frame, disabled: true, rect: { x: 347, y: 178, width: 100, height: 100 } }),
		).toEqual({ x: 347, y: 178, guides: [] });
	});
	it("uses the displayed-pixel threshold at a smaller preview zoom", () => {
		const rect = { x: 339, y: 165, width: 100, height: 100 };
		expect(snapCanvasRect({ frame, rect, threshold: 6 / 0.5 })).toMatchObject({ x: 350, y: 175 });
	});
	it("ignores non-finite and empty targets", () => {
		expect(
			snapCanvasRect({
				frame,
				rect: { x: 111, y: 72, width: 80, height: 40 },
				targets: [
					{ x: 112, y: 73, width: 0, height: 40 },
					{ x: 112, y: 73, width: Number.NaN, height: 40 },
				],
			}).guides,
		).toEqual([]);
	});
	it("does not snap a recording-local annotation beyond its parent bounds", () => {
		const result = snapCanvasRect({
			frame,
			rect: { x: 103, y: 72, width: 80, height: 40 },
			targets: [{ x: 98, y: 220, width: 30, height: 30 }],
			bounds: { minX: 100, maxX: 620, minY: 50, maxY: 360 },
		});
		expect(result.x).toBe(103);
		expect(result.guides).toEqual([]);
	});
	it("finds visual bounds of rotated elements while preserving their center", () => {
		const rect = getRotatedCanvasRect(
			{ id: "rotated", x: 200, y: 150, width: 100, height: 50 },
			90,
		);
		expect(rect.x).toBeCloseTo(225);
		expect(rect.y).toBeCloseTo(125);
		expect(rect.width).toBeCloseTo(50);
		expect(rect.height).toBeCloseTo(100);
	});
});
