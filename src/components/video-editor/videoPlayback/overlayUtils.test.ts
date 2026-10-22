import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { updateOverlayIndicator } from "./overlayUtils";

function createElements() {
	const overlayEl = document.createElement("div");
	const indicatorEl = document.createElement("div");
	Object.defineProperties(overlayEl, {
		clientWidth: { configurable: true, value: 800 },
		clientHeight: { configurable: true, value: 450 },
	});
	return { overlayEl, indicatorEl };
}

function update(region: ZoomRegion | null) {
	const elements = createElements();
	updateOverlayIndicator({
		...elements,
		region,
		videoSize: { width: 1920, height: 1080 },
		baseScale: 1,
	});
	return elements;
}

describe("updateOverlayIndicator", () => {
	it("keeps the canvas interactive when no zoom region is selected", () => {
		const { overlayEl, indicatorEl } = update(null);

		expect(indicatorEl.style.display).toBe("none");
		expect(overlayEl.style.pointerEvents).toBe("auto");
	});

	it("keeps the canvas interactive for automatic zoom focus", () => {
		const { overlayEl, indicatorEl } = update({
			id: "zoom-1",
			startMs: 0,
			endMs: 1_000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
			focusMode: "auto",
		});

		expect(indicatorEl.style.display).toBe("none");
		expect(overlayEl.style.pointerEvents).toBe("auto");
	});

	it("keeps the canvas interactive while showing manual zoom focus", () => {
		const { overlayEl, indicatorEl } = update({
			id: "zoom-1",
			startMs: 0,
			endMs: 1_000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
			focusMode: "manual",
		});

		expect(indicatorEl.style.display).toBe("block");
		expect(overlayEl.style.pointerEvents).toBe("auto");
	});
});
