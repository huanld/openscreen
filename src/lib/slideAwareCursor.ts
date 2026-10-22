import type { BlankSlideRegion, CursorTelemetryPoint } from "@/components/video-editor/types";
import { interpolateCursorAt } from "@/components/video-editor/videoPlayback/cursorFollowUtils";
import { mergeSlideIntervals } from "./insertedSlideTiming";

const cache = new WeakMap<
	CursorTelemetryPoint[],
	WeakMap<BlankSlideRegion[], CursorTelemetryPoint[]>
>();

/** Keep auto-follow focus on the same recorded cursor point across a slide hold. */
export function slideAwareCursorTelemetry(
	points: CursorTelemetryPoint[] = [],
	slides?: BlankSlideRegion[],
): CursorTelemetryPoint[] {
	if (!points.length || !slides?.length) return points;
	let entries = cache.get(points);
	if (!entries) {
		entries = new WeakMap();
		cache.set(points, entries);
	}
	const existing = entries.get(slides);
	if (existing) return existing;
	const intervals = mergeSlideIntervals(slides);
	const anchors: Array<{ startMs: number; endMs: number; sourceMs: number }> = [];
	let pausedMs = 0;
	for (const slide of intervals) {
		anchors.push({ ...slide, sourceMs: slide.startMs - pausedMs });
		pausedMs += slide.endMs - slide.startMs;
	}
	const mapped = new Map<number, CursorTelemetryPoint>();
	for (const point of points) {
		const timeMs =
			point.timeMs +
			anchors.reduce(
				(sum, slide) => sum + (point.timeMs >= slide.sourceMs ? slide.endMs - slide.startMs : 0),
				0,
			);
		mapped.set(timeMs, { ...point, timeMs });
	}
	for (const slide of anchors) {
		const focus = interpolateCursorAt(points, slide.sourceMs);
		if (!focus) continue;
		for (const timeMs of [slide.startMs, slide.endMs])
			if (!mapped.has(timeMs)) mapped.set(timeMs, { timeMs, ...focus, interactionType: "move" });
	}
	const result = [...mapped.values()].sort((a, b) => a.timeMs - b.timeMs);
	entries.set(slides, result);
	return result;
}
