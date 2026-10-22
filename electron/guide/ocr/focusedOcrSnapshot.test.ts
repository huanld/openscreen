import { describe, expect, it } from "vitest";
import type { OcrBlock } from "../../../src/guide/contracts";
import { remapFocusedOcrBlocks } from "./focusedOcrSnapshot";

describe("remapFocusedOcrBlocks", () => {
	it("maps boxes from a focused crop back to the original snapshot coordinates", () => {
		const blocks: OcrBlock[] = [
			{
				id: "ocr-1",
				snapshotId: "snapshot-1",
				text: "Settings",
				confidence: 0.9,
				box: { x: 0.25, y: 0.5, width: 0.2, height: 0.1 },
			},
		];

		const remapped = remapFocusedOcrBlocks(blocks, {
			cropX: 320,
			cropY: 180,
			cropWidth: 640,
			cropHeight: 360,
			originalWidth: 1280,
			originalHeight: 720,
		});

		expect(remapped[0]?.box).toEqual({
			x: 0.375,
			y: 0.5,
			width: 0.1,
			height: 0.05,
		});
	});
});
