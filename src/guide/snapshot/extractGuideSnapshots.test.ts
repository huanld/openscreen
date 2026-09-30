import { describe, expect, it, vi } from "vitest";
import { drawSnapshotMarker } from "./extractGuideSnapshots";

describe("drawSnapshotMarker", () => {
	it("draws a visible halo and a centered target dot", () => {
		const arcs: Array<{ x: number; y: number; radius: number }> = [];
		const fills: string[] = [];
		const strokes: Array<{ color: string; width: number }> = [];
		const context = {
			fillStyle: "",
			lineWidth: 0,
			shadowBlur: 0,
			shadowColor: "",
			strokeStyle: "",
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			arc: (x: number, y: number, radius: number) => arcs.push({ x, y, radius }),
			fill() {
				fills.push(this.fillStyle);
			},
			stroke() {
				strokes.push({ color: this.strokeStyle, width: this.lineWidth });
			},
		};

		drawSnapshotMarker(
			context as unknown as CanvasRenderingContext2D,
			{ width: 1280, height: 720 } as HTMLCanvasElement,
			{ x: 580, y: 388 },
		);

		expect(arcs).toEqual([
			{ x: 580, y: 388, radius: 22 },
			{ x: 580, y: 388, radius: 5 },
		]);
		expect(fills).toEqual(["rgba(250, 204, 21, 0.34)", "rgba(220, 38, 38, 1)"]);
		expect(strokes).toEqual([
			{ color: "rgba(220, 38, 38, 0.98)", width: 3 },
			{ color: "rgba(255, 255, 255, 0.98)", width: 2 },
		]);
		expect(context.save).toHaveBeenCalledOnce();
		expect(context.restore).toHaveBeenCalledOnce();
	});

	it("clamps marker size on very small and very large snapshots", () => {
		const radii: number[] = [];
		const context = {
			fillStyle: "",
			lineWidth: 0,
			shadowBlur: 0,
			shadowColor: "",
			strokeStyle: "",
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			arc: (_x: number, _y: number, radius: number) => radii.push(radius),
			fill: vi.fn(),
			stroke: vi.fn(),
		};

		for (const size of [100, 4000]) {
			drawSnapshotMarker(
				context as unknown as CanvasRenderingContext2D,
				{ width: size, height: size } as HTMLCanvasElement,
				{ x: 50, y: 50 },
			);
		}

		expect(radii).toEqual([20, 5, 36, 9]);
	});
});
