import { describe, expect, it } from "vitest";
import { getImageAnnotationSize, getImageAnnotationTimeRange } from "./imageAnnotation";

describe("image annotations", () => {
	it("preserves landscape and portrait image aspect ratios", () => {
		expect(getImageAnnotationSize(1920, 1080)).toEqual({ width: 35, height: 19.6875 });
		expect(getImageAnnotationSize(1080, 1920)).toEqual({ width: 19.6875, height: 35 });
	});

	it("falls back safely when image metadata is unavailable", () => {
		expect(getImageAnnotationSize(0, Number.NaN)).toEqual({ width: 35, height: 35 });
	});

	it("keeps a newly inserted image inside the video duration", () => {
		expect(getImageAnnotationTimeRange(9.8, 10)).toEqual({ startMs: 8500, endMs: 10000 });
		expect(getImageAnnotationTimeRange(2, 10)).toEqual({ startMs: 2000, endMs: 6000 });
		expect(getImageAnnotationTimeRange(0, 1)).toEqual({ startMs: 0, endMs: 1000 });
	});
});
