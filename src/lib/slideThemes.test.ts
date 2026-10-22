import { describe, expect, it } from "vitest";
import { parseCssGradient } from "@/lib/exporter/gradientParser";
import { classifyWallpaper } from "@/lib/wallpaper";
import { SLIDE_FRAMING_PRESETS, SLIDE_THEME_PRESETS } from "./slideThemes";

describe("slide themes", () => {
	it("uses unique identifiers and exportable gradients", () => {
		expect(new Set(SLIDE_THEME_PRESETS.map((preset) => preset.id)).size).toBe(
			SLIDE_THEME_PRESETS.length,
		);

		for (const preset of SLIDE_THEME_PRESETS) {
			expect(classifyWallpaper(preset.value).kind).toBe("gradient");
			const parsed = parseCssGradient(preset.value);
			expect(parsed, preset.id).not.toBeNull();
			expect(parsed?.stops.length, preset.id).toBeGreaterThanOrEqual(2);
		}
	});

	it("defines complete PowerPoint and Canva framing presets", () => {
		expect(SLIDE_FRAMING_PRESETS.map((preset) => preset.id)).toEqual([
			"slide169",
			"desktop",
			"story",
			"square",
		]);
		for (const preset of SLIDE_FRAMING_PRESETS) {
			expect(preset.padding).toBeGreaterThan(0);
			expect(preset.borderRadius).toBeGreaterThanOrEqual(0);
			expect(preset.shadowIntensity).toBeGreaterThanOrEqual(0);
		}
	});
});
