export interface MediaClipTiming {
	startMs: number;
	endMs: number;
	sourceStartMs?: number;
	sourceDurationMs?: number;
	volume?: number;
	fadeInMs?: number;
	fadeOutMs?: number;
}

const finite = (value: number | undefined, fallback: number) =>
	value !== undefined && Number.isFinite(value) ? value : fallback;

/** Optional fields keep older projects playing from the beginning of their source. */
export function normalizeMediaClipTiming<T extends MediaClipTiming>(
	clip: T,
	preserveLegacyDuration = false,
): T {
	const startMs = Math.max(0, Math.round(finite(clip.startMs, 0)));
	const sourceDurationMs = Math.max(1, finite(clip.sourceDurationMs, Infinity));
	const sourceStartMs = Math.min(
		sourceDurationMs - 1,
		Math.max(0, Math.round(finite(clip.sourceStartMs, 0))),
	);
	const requestedEnd = Math.max(startMs + 1, Math.round(finite(clip.endMs, startMs + 1)));
	const endMs =
		preserveLegacyDuration && clip.sourceStartMs === undefined
			? requestedEnd
			: Math.min(startMs + sourceDurationMs - sourceStartMs, requestedEnd);
	const maxFade = (endMs - startMs) / 2;
	return {
		...clip,
		startMs,
		endMs,
		...(clip.sourceStartMs !== undefined ? { sourceStartMs } : {}),
		...(clip.fadeInMs !== undefined
			? { fadeInMs: Math.min(maxFade, Math.max(0, finite(clip.fadeInMs, 0))) }
			: {}),
		...(clip.fadeOutMs !== undefined
			? { fadeOutMs: Math.min(maxFade, Math.max(0, finite(clip.fadeOutMs, 0))) }
			: {}),
	};
}

/** Moving retains source in; dragging the left trim handle advances source in. */
export function resizeMediaClipSpan<T extends MediaClipTiming>(
	clip: T,
	span: { start: number; end: number },
): T {
	const current = normalizeMediaClipTiming(clip);
	let startMs = Math.max(0, Math.round(span.start));
	const endMs = Math.max(startMs + 1, Math.round(span.end));
	const isMove = Math.abs(endMs - startMs - (current.endMs - current.startMs)) <= 1;
	let sourceStartMs = current.sourceStartMs ?? 0;
	if (!isMove) {
		startMs = Math.max(startMs, current.startMs - sourceStartMs);
		sourceStartMs += startMs - current.startMs;
	}
	return normalizeMediaClipTiming({ ...current, startMs, endMs, sourceStartMs });
}

export function getMediaClipSourceTimeMs(clip: MediaClipTiming, timelineMs: number): number | null {
	if (timelineMs < clip.startMs || timelineMs >= clip.endMs) return null;
	return Math.max(0, finite(clip.sourceStartMs, 0)) + timelineMs - clip.startMs;
}

/** Shared by preview and the exported audio mix; fades use source timeline time. */
export function getMediaClipGain(clip: MediaClipTiming, timelineMs: number): number {
	if (timelineMs < clip.startMs || timelineMs >= clip.endMs) return 0;
	const volume = Math.max(0, Math.min(2, finite(clip.volume, 1)));
	const duration = Math.max(1, clip.endMs - clip.startMs);
	const fadeIn = Math.min(duration / 2, Math.max(0, finite(clip.fadeInMs, 0)));
	const fadeOut = Math.min(duration / 2, Math.max(0, finite(clip.fadeOutMs, 0)));
	return (
		volume *
		Math.min(
			1,
			fadeIn > 0 ? (timelineMs - clip.startMs) / fadeIn : 1,
			fadeOut > 0 ? (clip.endMs - timelineMs) / fadeOut : 1,
		)
	);
}

export function splitMediaClip<T extends MediaClipTiming & { id: string }>(
	clip: T,
	timelineMs: number,
	rightId: string,
): [T, T] | null {
	const current = normalizeMediaClipTiming(clip);
	const cut = Math.round(timelineMs);
	// Match the timeline's 100 ms minimum so each part remains draggable.
	if (cut - current.startMs < 100 || current.endMs - cut < 100) return null;
	return [
		normalizeMediaClipTiming({ ...current, endMs: cut, fadeOutMs: 0 }),
		normalizeMediaClipTiming({
			...current,
			id: rightId,
			startMs: cut,
			sourceStartMs: (current.sourceStartMs ?? 0) + cut - current.startMs,
			fadeInMs: 0,
		}),
	];
}
