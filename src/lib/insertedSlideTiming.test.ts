import { describe, expect, it } from "vitest";
import type { BlankSlideRegion } from "@/components/video-editor/types";
import { interpolateCursorAt } from "@/components/video-editor/videoPlayback/cursorFollowUtils";
import {
	createInsertedTimelineSegments,
	insertedTimelineDurationMs,
	insertedTimelineMetrics,
	insertedTimelineSamples,
	mergeSlideIntervals,
	timelineToSourceMs,
} from "./insertedSlideTiming";
import { slideAwareCursorTelemetry } from "./slideAwareCursor";
import {
	clipContentTimeMs,
	clipEndWithSlides,
	resizeClipWithSlides,
	splitClipWithSlides,
} from "./slideAwareMediaClip";

const slides: BlankSlideRegion[] = [
	{ id: "first", startMs: 1000, endMs: 3000, backgroundColor: "#fff" },
	{ id: "second", startMs: 5000, endMs: 6000, backgroundColor: "#fff" },
];

describe("inserted slide timing", () => {
	it("holds the source for the complete slide and resumes without losing the tail", () => {
		expect(
			[0, 999, 1000, 2000, 2999, 3000, 4000, 5500, 6000, 9000].map((time) =>
				timelineToSourceMs(time, slides),
			),
		).toEqual([0, 999, 1000, 1000, 1000, 1000, 2000, 3000, 3000, 6000]);
		expect(insertedTimelineDurationMs(6000, slides)).toBe(9000);
	});
	it("unions overlaps and touching slides, ignores invalid spans", () => {
		const intervals = mergeSlideIntervals([
			{ startMs: 2000, endMs: 4000 },
			{ startMs: 1000, endMs: 3000 },
			{ startMs: 4000, endMs: 4500 },
			{ startMs: NaN, endMs: 10 },
			{ startMs: 500, endMs: 400 },
		]);
		expect(intervals).toEqual([{ startMs: 1000, endMs: 4500 }]);
		expect(insertedTimelineDurationMs(6000, intervals)).toBe(9500);
	});
	it("handles slides at the first frame and at the source tail", () => {
		const bookends = [
			{ startMs: 0, endMs: 1000 },
			{ startMs: 4000, endMs: 5000 },
		];
		expect(timelineToSourceMs(500, bookends)).toBe(0);
		expect(timelineToSourceMs(4500, bookends)).toBe(3000);
		expect(insertedTimelineDurationMs(3000, bookends)).toBe(5000);
	});
	it("exports trim and speed edits on the same presentation clock", () => {
		const segments = createInsertedTimelineSegments(
			6000,
			slides,
			[{ id: "trim", startMs: 1500, endMs: 2500 }],
			[{ id: "speed", startMs: 3000, endMs: 5000, speed: 2 }],
		);
		expect(insertedTimelineMetrics(segments, 10)).toEqual({
			effectiveDuration: 7,
			totalFrames: 70,
		});
		const samples = [...insertedTimelineSamples(segments, 10)];
		expect(samples.find((sample) => sample.timelineMs === 2500)?.sourceMs).toBe(1000);
		expect(samples.find((sample) => sample.timelineMs === 4000)?.sourceMs).toBe(2000);
		expect(samples.at(-1)).toEqual({ timelineMs: 8900, sourceMs: 5900 });
	});
	it("keeps projects without slides on their existing clock", () => {
		expect(timelineToSourceMs(1234)).toBe(1234);
		expect(insertedTimelineDurationMs(6000)).toBe(6000);
	});
	it("holds auto-follow cursor focus and resumes its original recorded movement", () => {
		const points = [
			{ timeMs: 0, cx: 0, cy: 0 },
			{ timeMs: 2000, cx: 1, cy: 1 },
		];
		const mapped = slideAwareCursorTelemetry(points, slides);
		expect(interpolateCursorAt(mapped, 2000)).toEqual({ cx: 0.5, cy: 0.5 });
		expect(interpolateCursorAt(mapped, 3500)).toEqual({ cx: 0.75, cy: 0.75 });
		expect(slideAwareCursorTelemetry(points, slides)).toBe(mapped);
	});
});

describe("inserted media clips across slides", () => {
	const clip = {
		id: "clip",
		startMs: 500,
		endMs: 4500,
		sourceStartMs: 1000,
		sourceDurationMs: 8000,
		volume: 1,
	};
	it("extends the clip span and preserves the media content time", () => {
		expect(clipEndWithSlides(clip, slides)).toBe(7500);
		expect(clipContentTimeMs(clip, 2000, slides)).toBe(1000);
		expect(clipContentTimeMs(clip, 7000, slides)).toBe(4000);
	});
	it("starts a clip placed within a slide after that slide ends", () => {
		expect(clipEndWithSlides({ ...clip, startMs: 2000, endMs: 4000 }, slides)).toBe(5000);
	});
	it("left trimming after a slide advances by content time, and moving retains the source in", () => {
		const trimmed = resizeClipWithSlides(clip, { start: 3500, end: 7500 }, slides);
		expect(trimmed).toMatchObject({ startMs: 3500, endMs: 6500, sourceStartMs: 2000 });
		const moved = resizeClipWithSlides(clip, { start: 1500, end: 8500 }, slides);
		expect(moved.sourceStartMs).toBe(1000);
		expect(moved.endMs - moved.startMs).toBe(4000);
	});
	it("splits at the actual content position and keeps the right part at the playhead", () => {
		const parts = splitClipWithSlides(clip, 4000, "right", slides)!;
		expect(parts[0]).toMatchObject({ startMs: 500, endMs: 2000, sourceStartMs: 1000 });
		expect(parts[1]).toMatchObject({ startMs: 4000, endMs: 6500, sourceStartMs: 2500 });
		expect(clipEndWithSlides(parts[1], slides)).toBe(7500);
	});
});
