import { describe, expect, it } from "vitest";
import { getCursorHighlightBorderWidth, getCursorHighlightDiameter } from "./cursorHighlight";

describe("cursor highlight sizing", () => {
	it("scales the halo with the rendered cursor", () => {
		expect(getCursorHighlightDiameter(80)).toBe(148);
		expect(getCursorHighlightBorderWidth(80)).toBeCloseTo(4);
	});

	it("keeps small cursors visible", () => {
		expect(getCursorHighlightDiameter(10)).toBe(48);
		expect(getCursorHighlightBorderWidth(10)).toBe(2);
	});

	it("supports a smaller adjustable halo without shrinking the cursor", () => {
		expect(getCursorHighlightDiameter(80, 0.7)).toBeCloseTo(103.6);
		expect(getCursorHighlightDiameter(10, 0.5)).toBe(24);
	});
});
