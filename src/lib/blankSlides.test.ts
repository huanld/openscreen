import { describe, expect, it } from "vitest";
import { isBlankSlideActive, resolveBlankSlidePresentation } from "./blankSlides";

describe("isBlankSlideActive", () => {
	const slides = [{ id: "slide-1", startMs: 1_000, endMs: 4_000 }];

	it("uses an inclusive start and exclusive end", () => {
		expect(isBlankSlideActive(slides, 999)).toBe(false);
		expect(isBlankSlideActive(slides, 1_000)).toBe(true);
		expect(isBlankSlideActive(slides, 3_999)).toBe(true);
		expect(isBlankSlideActive(slides, 4_000)).toBe(false);
	});

	it("fades a presentation slide in, holds it, and fades it out", () => {
		const animatedSlides = [
			{
				...slides[0],
				transitionIn: "fade" as const,
				transitionOut: "fade" as const,
				transitionDurationMs: 500,
			},
		];

		expect(resolveBlankSlidePresentation(animatedSlides, 1_000)?.opacity).toBe(0);
		expect(resolveBlankSlidePresentation(animatedSlides, 1_250)?.opacity).toBeCloseTo(0.5);
		expect(resolveBlankSlidePresentation(animatedSlides, 2_000)?.phase).toBe("hold");
		expect(resolveBlankSlidePresentation(animatedSlides, 3_750)?.opacity).toBeCloseTo(0.5);
	});

	it("moves slide transitions along the selected edge", () => {
		const animatedSlides = [
			{
				...slides[0],
				transitionIn: "slide-left" as const,
				transitionOut: "slide-down" as const,
				transitionDurationMs: 500,
			},
		];

		expect(resolveBlankSlidePresentation(animatedSlides, 1_000)?.offsetX).toBe(-1);
		expect(resolveBlankSlidePresentation(animatedSlides, 3_999)?.offsetY).toBeGreaterThan(0.99);
	});

	it("keeps legacy slides immediate when transition settings are absent", () => {
		const presentation = resolveBlankSlidePresentation(slides, 1_000);
		expect(presentation?.phase).toBe("hold");
		expect(presentation?.opacity).toBe(1);
	});
});
