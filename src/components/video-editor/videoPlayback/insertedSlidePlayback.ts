import type React from "react";
import {
	insertedTimelineDurationMs,
	isSourcePausedAt,
	mergeSlideIntervals,
	timelineToSourceMs,
} from "@/lib/insertedSlideTiming";
import type { BlankSlideRegion, SpeedRegion, TrimRegion } from "../types";

interface PlaybackParams {
	video: HTMLVideoElement;
	currentTimeRef: React.MutableRefObject<number>;
	isPlayingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	blankSlideRegionsRef: React.MutableRefObject<BlankSlideRegion[]>;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	onTimeUpdate: (seconds: number) => void;
	onPlayStateChange: (playing: boolean) => void;
	onScrubChange?: (scrubbing: boolean) => void;
	isSeekingRef: React.MutableRefObject<boolean>;
	isScrubbingRef?: React.MutableRefObject<boolean>;
	getSourceDurationSec?: () => number;
}

/** The editor clock continues through slides while the source media is paused. */
export function createInsertedSlidePlayback(params: PlaybackParams) {
	const { video, currentTimeRef, isPlayingRef, allowPlaybackRef } = params;
	let raf: number | null = null;
	let lastWallMs = 0;
	let playPending = false;
	let destroyed = false;
	let scrubTimer: ReturnType<typeof setTimeout> | null = null;
	const slides = () => params.blankSlideRegionsRef.current;
	const sourceDurationMs = () =>
		(params.getSourceDurationSec?.() ?? (Number.isFinite(video.duration) ? video.duration : 0)) *
		1000;
	const durationMs = () => insertedTimelineDurationMs(sourceDurationMs(), slides());
	const emit = (timeMs: number) => {
		currentTimeRef.current = Math.max(0, Math.min(durationMs(), timeMs));
		params.onTimeUpdate(currentTimeRef.current / 1000);
	};
	const rateAt = (timeMs: number) =>
		params.speedRegionsRef.current.find(
			(region) => timeMs >= region.startMs && timeMs < region.endMs,
		)?.speed ?? 1;
	const schedule = () => {
		if (!destroyed && isPlayingRef.current && raf === null) raf = requestAnimationFrame(tick);
	};
	const syncMedia = (forceSeek = false) => {
		const timeMs = currentTimeRef.current;
		const sourceSec = Math.min(sourceDurationMs(), timelineToSourceMs(timeMs, slides())) / 1000;
		const paused = isSourcePausedAt(timeMs, slides()) || sourceSec * 1000 >= sourceDurationMs();
		if (paused || !isPlayingRef.current) video.pause();
		if ((forceSeek || paused) && Math.abs(video.currentTime - sourceSec) > 0.002)
			video.currentTime = sourceSec;
		video.playbackRate = rateAt(timeMs);
		if (!paused && isPlayingRef.current && video.paused && !playPending) {
			playPending = true;
			void video
				.play()
				.catch(() => {
					if (
						!destroyed &&
						!isSourcePausedAt(currentTimeRef.current, slides()) &&
						allowPlaybackRef.current
					)
						pause();
				})
				.finally(() => {
					playPending = false;
				});
		}
	};
	function tick(wallMs: number) {
		raf = null;
		if (destroyed || !isPlayingRef.current) return;
		const before = currentTimeRef.current;
		const elapsed = Math.max(0, wallMs - lastWallMs);
		lastWallMs = wallMs;
		const intervals = mergeSlideIntervals(slides());
		const slide = intervals.find((region) => before >= region.startMs && before < region.endMs);
		let next: number;
		if (slide) {
			next = Math.min(slide.endMs, before + elapsed * rateAt(before));
		} else {
			const sourceBefore = timelineToSourceMs(before, intervals);
			next = before + Math.max(0, video.currentTime * 1000 - sourceBefore);
			const upcoming = intervals.find(
				(region) => region.startMs >= before && region.startMs <= next,
			);
			if (upcoming) next = upcoming.startMs;
			// A slide may be positioned after the last source frame.
			if (sourceBefore >= sourceDurationMs() && before < durationMs())
				next = before + elapsed * rateAt(before);
		}
		for (let i = 0; i <= params.trimRegionsRef.current.length; i++) {
			const trim = params.trimRegionsRef.current.find(
				(region) => next >= region.startMs && next < region.endMs,
			);
			if (!trim) break;
			next = trim.endMs;
		}
		emit(next);
		if (currentTimeRef.current >= durationMs()) {
			pause();
			return;
		}
		syncMedia(
			!!slide || Math.abs(timelineToSourceMs(next, intervals) - video.currentTime * 1000) > 40,
		);
		schedule();
	}
	function pause() {
		allowPlaybackRef.current = false;
		isPlayingRef.current = false;
		video.pause();
		if (raf !== null) cancelAnimationFrame(raf);
		raf = null;
		params.onPlayStateChange(false);
	}
	const seek = (seconds: number) => {
		emit(seconds * 1000);
		lastWallMs = performance.now();
		syncMedia(true);
		schedule();
	};
	const play = async () => {
		if (currentTimeRef.current >= durationMs()) seek(0);
		allowPlaybackRef.current = true;
		isPlayingRef.current = true;
		lastWallMs = performance.now();
		params.onPlayStateChange(true);
		syncMedia(true);
		schedule();
	};
	return {
		play,
		pause,
		seek,
		handlePlay: () => {
			if (!allowPlaybackRef.current) video.pause();
		},
		handlePause: () => {
			if (!allowPlaybackRef.current && isPlayingRef.current) pause();
		},
		handleSeeked: () => {
			params.isSeekingRef.current = false;
			if (scrubTimer) clearTimeout(scrubTimer);
			scrubTimer = setTimeout(() => {
				if (params.isScrubbingRef) params.isScrubbingRef.current = false;
				params.onScrubChange?.(false);
			}, 150);
			schedule();
		},
		handleSeeking: () => {
			params.isSeekingRef.current = true;
			if (params.isScrubbingRef) params.isScrubbingRef.current = true;
			params.onScrubChange?.(true);
		},
		destroy: () => {
			destroyed = true;
			if (raf !== null) cancelAnimationFrame(raf);
			if (scrubTimer) clearTimeout(scrubTimer);
		},
	};
}
