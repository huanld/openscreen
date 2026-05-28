import { describe, expect, it } from "vitest";
import type { GuideSnapshot, OcrBlock } from "../../../src/guide/contracts";
import {
	DefaultGuideOcrClient,
	normalizeOcrResponse,
	parseWindowsOcrPayload,
} from "./paddleOcrClient";

const snapshot: GuideSnapshot = {
	id: "snapshot-1",
	eventId: "event-1",
	timeMs: 1000,
	offsetMs: 500,
	path: "/tmp/step-001.png",
	width: 1000,
	height: 800,
};

describe("normalizeOcrResponse", () => {
	it("normalizes pixel boxes into guide OCR blocks", () => {
		const blocks = normalizeOcrResponse(
			{
				blocks: [
					{
						text: "Save",
						confidence: 92,
						box: { x: 400, y: 320, width: 120, height: 40 },
					},
				],
			},
			snapshot,
		);

		expect(blocks).toEqual([
			{
				id: "ocr-snapshot-1-1",
				snapshotId: "snapshot-1",
				text: "Save",
				confidence: 0.92,
				box: { x: 0.4, y: 0.4, width: 0.12, height: 0.05 },
			},
		]);
	});

	it("normalizes polygon responses", () => {
		const blocks = normalizeOcrResponse(
			[
				{
					text: "Next",
					score: 0.8,
					bbox: [
						[100, 200],
						[300, 200],
						[300, 260],
						[100, 260],
					],
				},
			],
			snapshot,
		);

		expect(blocks[0]).toMatchObject({
			text: "Next",
			confidence: 0.8,
			box: { x: 0.1, y: 0.25, width: 0.2, height: 0.075 },
		});
	});
});

describe("DefaultGuideOcrClient", () => {
	it("falls back when the HTTP OCR service is unavailable", async () => {
		const fallbackBlock: OcrBlock = {
			id: "ocr-snapshot-1-1",
			snapshotId: "snapshot-1",
			text: "Save",
			confidence: 0.75,
			box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
		};
		const client = new DefaultGuideOcrClient(
			{
				recognize: async () => {
					throw new Error("HTTP down");
				},
			},
			{
				recognize: async () => [fallbackBlock],
			},
		);

		await expect(client.recognize(snapshot)).resolves.toEqual([fallbackBlock]);
	});
});

describe("parseWindowsOcrPayload", () => {
	it("recovers from raw control characters in OCR text", () => {
		const payload = parseWindowsOcrPayload(
			'{"blocks":[{"text":"Save\u0001now","confidence":0.75,"box":{"x":1,"y":2,"width":3,"height":4}}]}',
		);

		expect(payload).toEqual({
			blocks: [
				{
					text: "Save now",
					confidence: 0.75,
					box: { x: 1, y: 2, width: 3, height: 4 },
				},
			],
		});
	});
});
