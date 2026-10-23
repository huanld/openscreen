import { describe, expect, it } from "vitest";
import { normalizeOcrBlocks } from "./normalizeOcrResponse";

describe("normalizeOcrBlocks", () => {
	it("normalizes pixel boxes and keeps OCR reading order", () => {
		expect(
			normalizeOcrBlocks(
				{
					blocks: [
						{
							text: " OpenScreen ",
							confidence: 98,
							box: { x: 100, y: 50, width: 200, height: 40 },
						},
						{
							text: "OCR",
							score: 0.87,
							bbox: [
								[400, 100],
								[500, 100],
								[500, 130],
								[400, 130],
							],
						},
					],
				},
				{ width: 1000, height: 500 },
			),
		).toEqual([
			{
				text: "OpenScreen",
				confidence: 0.98,
				box: { x: 0.1, y: 0.1, width: 0.2, height: 0.08 },
			},
			{
				text: "OCR",
				confidence: 0.87,
				box: { x: 0.4, y: 0.2, width: 0.1, height: 0.06 },
			},
		]);
	});

	it("drops malformed and zero-area blocks", () => {
		expect(
			normalizeOcrBlocks(
				{
					blocks: [
						{ text: "", box: { x: 0, y: 0, width: 1, height: 1 } },
						{ text: "missing box" },
						{ text: "zero", box: { x: 0, y: 0, width: 0, height: 1 } },
					],
				},
				{ width: 100, height: 100 },
			),
		).toEqual([]);
	});

	it("clips boxes to the image bounds", () => {
		expect(
			normalizeOcrBlocks([{ text: "edge", box: { x: 90, y: 80, width: 30, height: 40 } }], {
				width: 100,
				height: 100,
			})[0]?.box,
		).toEqual({ x: 0.9, y: 0.8, width: 0.1, height: 0.2 });
	});

	it("clips already-normalized boxes without treating overflow as pixels", () => {
		expect(
			normalizeOcrBlocks([{ text: "edge", box: { x: 0.9, y: 0.8, width: 0.3, height: 0.4 } }], {
				width: 100,
				height: 100,
			})[0]?.box,
		).toEqual({ x: 0.9, y: 0.8, width: 0.1, height: 0.2 });
	});
});
