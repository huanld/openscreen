import { describe, expect, it } from "vitest";
import { computeAnnotationAnimation } from "./annotationAnimations";

describe("computeAnnotationAnimation", () => {
	it("returns standard values when animation is none", () => {
		const anim = computeAnnotationAnimation({
			animation: "none",
			type: "text",
			content: "Hello OpenScreen",
			timeMs: 1500,
			startMs: 1000,
			endMs: 5000,
		});

		expect(anim.opacity).toBe(1);
		expect(anim.scale).toBe(1);
		expect(anim.translateY).toBe(0);
		expect(anim.displayedText).toBe("Hello OpenScreen");
	});

	it("computes fade-in progress smoothly", () => {
		const startMs = 1000;
		const endMs = 5000;
		// at start: opacity = 0
		const atStart = computeAnnotationAnimation({
			animation: "fade-in",
			type: "image",
			content: "data:image/png;base64,...",
			timeMs: startMs,
			startMs,
			endMs,
		});
		expect(atStart.opacity).toBe(0);

		// at mid intro (e.g. 250ms into 500ms intro): opacity = 0.5
		const atMid = computeAnnotationAnimation({
			animation: "fade-in",
			type: "image",
			content: "data:image/png;base64,...",
			timeMs: startMs + 250,
			startMs,
			endMs,
		});
		expect(atMid.opacity).toBeCloseTo(0.5, 2);

		// after intro (e.g. 600ms): opacity = 1
		const afterIntro = computeAnnotationAnimation({
			animation: "fade-in",
			type: "image",
			content: "data:image/png;base64,...",
			timeMs: startMs + 600,
			startMs,
			endMs,
		});
		expect(afterIntro.opacity).toBe(1);
	});

	it("computes typewriter typing character by character for text", () => {
		const startMs = 1000;
		const endMs = 5000;
		const text = "OpenScreen Slide";

		// at start
		const atStart = computeAnnotationAnimation({
			animation: "typewriter",
			type: "text",
			content: text,
			timeMs: startMs,
			startMs,
			endMs,
		});
		expect(atStart.displayedText).toBe("");

		// partially typed
		const atPartial = computeAnnotationAnimation({
			animation: "typewriter",
			type: "text",
			content: text,
			timeMs: startMs + 750, // halfway through 1500ms
			startMs,
			endMs,
		});
		expect(atPartial.displayedText?.length).toBeGreaterThan(0);
		expect(atPartial.displayedText?.length).toBeLessThanOrEqual(text.length);
		expect(text.startsWith(atPartial.displayedText!)).toBe(true);

		// fully typed
		const atFull = computeAnnotationAnimation({
			animation: "typewriter",
			type: "text",
			content: text,
			timeMs: startMs + 2000,
			startMs,
			endMs,
		});
		expect(atFull.displayedText).toBe(text);
	});

	it("computes pop-in scaling", () => {
		const startMs = 1000;
		const endMs = 5000;

		const atStart = computeAnnotationAnimation({
			animation: "pop-in",
			type: "image",
			content: "data:image/png...",
			timeMs: startMs,
			startMs,
			endMs,
		});
		expect(atStart.scale).toBeCloseTo(0.6, 2);
		expect(atStart.opacity).toBe(0);

		const atDone = computeAnnotationAnimation({
			animation: "pop-in",
			type: "image",
			content: "data:image/png...",
			timeMs: startMs + 500,
			startMs,
			endMs,
		});
		expect(atDone.scale).toBe(1);
		expect(atDone.opacity).toBe(1);
	});

	it("computes slide-up translation", () => {
		const startMs = 1000;
		const endMs = 5000;

		const atStart = computeAnnotationAnimation({
			animation: "slide-up",
			type: "text",
			content: "Slide Title",
			timeMs: startMs,
			startMs,
			endMs,
		});
		expect(atStart.translateY).toBeCloseTo(20, 1);
		expect(atStart.opacity).toBe(0);

		const atDone = computeAnnotationAnimation({
			animation: "slide-up",
			type: "text",
			content: "Slide Title",
			timeMs: startMs + 500,
			startMs,
			endMs,
		});
		expect(atDone.translateY).toBeCloseTo(0, 1);
		expect(atDone.opacity).toBe(1);
	});
});
