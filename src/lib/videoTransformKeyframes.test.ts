import { describe, expect, it } from "vitest";
import type { VideoTransformKeyframe } from "@/components/video-editor/types";
import { resolveVideoTransformAtTime } from "./videoTransformKeyframes";

const keyframes: VideoTransformKeyframe[] = [
	{ id: "small", timeMs: 1_000, position: { cx: 0.25, cy: 0.5 }, scale: 0.4 },
	{ id: "full", timeMs: 3_000, position: null, scale: 1 },
];

describe("resolveVideoTransformAtTime", () => {
	it("keeps the static layout before the first keyframe", () => {
		expect(resolveVideoTransformAtTime(keyframes, 500, { cx: 0.8, cy: 0.2 }, 0.75)).toEqual({
			position: { cx: 0.8, cy: 0.2 },
			scale: 0.75,
		});
	});

	it("smoothly interpolates video position and scale between keyframes", () => {
		expect(resolveVideoTransformAtTime(keyframes, 2_000, null, 1)).toEqual({
			position: { cx: 0.375, cy: 0.5 },
			scale: 0.7,
		});
	});

	it("holds the final layout after the last keyframe", () => {
		expect(resolveVideoTransformAtTime(keyframes, 5_000, null, 0.5)).toEqual({
			position: null,
			scale: 1,
		});
	});
});
