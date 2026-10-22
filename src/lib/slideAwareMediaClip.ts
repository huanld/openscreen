import type { BlankSlideRegion } from "@/components/video-editor/types";
import { mergeSlideIntervals, timelineToSourceMs } from "./insertedSlideTiming";
import {
	type MediaClipTiming,
	normalizeMediaClipTiming,
	resizeMediaClipSpan,
	splitMediaClip,
} from "./mediaClipTiming";

/** Stored clip length is media content length; its displayed span also includes slide holds. */
export function clipEndWithSlides(
	clip: MediaClipTiming,
	slides: readonly BlankSlideRegion[] = [],
): number {
	let cursor = clip.startMs;
	let remaining = clip.endMs - clip.startMs;
	for (const slide of mergeSlideIntervals(slides)) {
		if (slide.endMs <= cursor) continue;
		if (slide.startMs >= cursor + remaining) break;
		remaining -= Math.max(0, slide.startMs - cursor);
		cursor = slide.endMs;
	}
	return cursor + remaining;
}

export function clipContentTimeMs(
	clip: MediaClipTiming,
	timeMs: number,
	slides: readonly BlankSlideRegion[] = [],
): number {
	return (
		clip.startMs + timelineToSourceMs(timeMs, slides) - timelineToSourceMs(clip.startMs, slides)
	);
}

export function clipTimelineView<T extends MediaClipTiming>(
	clip: T,
	slides: readonly BlankSlideRegion[] = [],
): T {
	return { ...clip, endMs: clipEndWithSlides(clip, slides) };
}

export function resizeClipWithSlides<T extends MediaClipTiming>(
	clip: T,
	span: { start: number; end: number },
	slides: readonly BlankSlideRegion[] = [],
): T {
	if (!slides.length) return resizeMediaClipSpan(clip, span);
	const moved =
		Math.abs(span.start - clip.startMs - (span.end - clipEndWithSlides(clip, slides))) <= 1;
	const length = moved
		? clip.endMs - clip.startMs
		: timelineToSourceMs(span.end, slides) - timelineToSourceMs(span.start, slides);
	const sourceStartMs =
		(clip.sourceStartMs ?? 0) +
		(moved ? 0 : timelineToSourceMs(span.start, slides) - timelineToSourceMs(clip.startMs, slides));
	return normalizeMediaClipTiming({
		...clip,
		startMs: span.start,
		endMs: span.start + Math.max(1, length),
		sourceStartMs,
	});
}

export function splitClipWithSlides<T extends MediaClipTiming & { id: string }>(
	clip: T,
	timeMs: number,
	rightId: string,
	slides: readonly BlankSlideRegion[] = [],
): [T, T] | null {
	const cut = clipContentTimeMs(clip, timeMs, slides);
	const parts = splitMediaClip(clip, cut, rightId);
	if (!parts) return null;
	const [left, right] = parts;
	return [left, { ...right, startMs: timeMs, endMs: timeMs + right.endMs - right.startMs }];
}
