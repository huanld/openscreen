import type { BlankSlideRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";

type Span = Pick<BlankSlideRegion, "startMs" | "endMs">;

/** Overlapping or touching slides pause the source once, for their union. */
export function mergeSlideIntervals(slides: readonly Span[] = []): Span[] {
	const result: Span[] = [];
	for (const slide of [...slides].sort((a, b) => a.startMs - b.startMs)) {
		if (!Number.isFinite(slide.startMs) || !Number.isFinite(slide.endMs)) continue;
		const startMs = Math.max(0, slide.startMs);
		if (slide.endMs <= startMs) continue;
		const previous = result.at(-1);
		if (previous && startMs <= previous.endMs)
			previous.endMs = Math.max(previous.endMs, slide.endMs);
		else result.push({ startMs, endMs: slide.endMs });
	}
	return result;
}

export function timelineToSourceMs(timeMs: number, slides: readonly Span[] = []): number {
	const time = Math.max(0, timeMs);
	let pausedMs = 0;
	for (const slide of mergeSlideIntervals(slides)) {
		if (slide.startMs >= time) break;
		pausedMs += Math.max(0, Math.min(time, slide.endMs) - slide.startMs);
	}
	return Math.max(0, time - pausedMs);
}

export function insertedTimelineDurationMs(
	sourceDurationMs: number,
	slides: readonly Span[] = [],
): number {
	const intervals = mergeSlideIntervals(slides);
	return Math.max(
		0,
		sourceDurationMs + intervals.reduce((sum, slide) => sum + slide.endMs - slide.startMs, 0),
		intervals.at(-1)?.endMs ?? 0,
	);
}

export function isSourcePausedAt(timeMs: number, slides: readonly Span[] = []): boolean {
	return slides.some((slide) => timeMs >= slide.startMs && timeMs < slide.endMs);
}

export interface InsertedTimelineSegment {
	startMs: number;
	endMs: number;
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
	paused: boolean;
}

/** Trim/speed regions and slide effects all keep their editor timeline coordinates. */
export function createInsertedTimelineSegments(
	sourceDurationMs: number,
	slides: readonly Span[] = [],
	trims: readonly TrimRegion[] = [],
	speeds: readonly SpeedRegion[] = [],
): InsertedTimelineSegment[] {
	const intervals = mergeSlideIntervals(slides);
	const duration = insertedTimelineDurationMs(sourceDurationMs, intervals);
	const boundaries = new Set([0, duration]);
	for (const region of [...intervals, ...trims, ...speeds]) {
		boundaries.add(Math.max(0, Math.min(duration, region.startMs)));
		boundaries.add(Math.max(0, Math.min(duration, region.endMs)));
	}
	const sorted = [...boundaries].sort((a, b) => a - b);
	const result: InsertedTimelineSegment[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const startMs = sorted[i];
		const endMs = sorted[i + 1];
		if (endMs <= startMs || trims.some((trim) => startMs >= trim.startMs && startMs < trim.endMs))
			continue;
		const speed =
			speeds.find((region) => startMs >= region.startMs && startMs < region.endMs)?.speed ?? 1;
		result.push({
			startMs,
			endMs,
			sourceStartMs: Math.min(sourceDurationMs, timelineToSourceMs(startMs, intervals)),
			sourceEndMs: Math.min(sourceDurationMs, timelineToSourceMs(endMs, intervals)),
			speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
			paused: isSourcePausedAt(startMs, intervals),
		});
	}
	return result;
}

export function insertedTimelineMetrics(
	segments: readonly InsertedTimelineSegment[],
	frameRate: number,
) {
	return {
		effectiveDuration: segments.reduce(
			(sum, segment) => sum + (segment.endMs - segment.startMs) / segment.speed / 1000,
			0,
		),
		totalFrames: segments.reduce(
			(sum, segment) =>
				sum +
				Math.max(
					0,
					Math.ceil(((segment.endMs - segment.startMs - 1) / segment.speed / 1000) * frameRate),
				),
			0,
		),
	};
}

export function* insertedTimelineSamples(
	segments: readonly InsertedTimelineSegment[],
	frameRate: number,
) {
	for (const segment of segments) {
		const count = Math.max(
			0,
			Math.ceil(((segment.endMs - segment.startMs - 1) / segment.speed / 1000) * frameRate),
		);
		for (let index = 0; index < count; index++) {
			const timeMs = segment.startMs + (index / frameRate) * segment.speed * 1000;
			yield {
				timelineMs: timeMs,
				sourceMs: segment.paused
					? segment.sourceStartMs
					: Math.min(segment.sourceEndMs, segment.sourceStartMs + timeMs - segment.startMs),
			};
		}
	}
}
