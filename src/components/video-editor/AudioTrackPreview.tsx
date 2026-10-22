import { useEffect, useRef } from "react";
import { isSourcePausedAt } from "@/lib/insertedSlideTiming";
import { getMediaClipGain } from "@/lib/mediaClipTiming";
import { clipContentTimeMs } from "@/lib/slideAwareMediaClip";
import { getAudioSourceTimeSec, getTimelinePlaybackRate } from "./audioTrack";
import type { AudioRegion, BlankSlideRegion, SpeedRegion } from "./types";

interface AudioTrackPreviewProps {
	region: AudioRegion;
	sourceUrl: string;
	currentTime: number;
	isPlaying: boolean;
	speedRegions: SpeedRegion[];
	blankSlideRegions?: BlankSlideRegion[];
}

type PitchPreservingMedia = HTMLAudioElement & {
	preservesPitch?: boolean;
	mozPreservesPitch?: boolean;
	webkitPreservesPitch?: boolean;
};

export default function AudioTrackPreview({
	region,
	sourceUrl,
	currentTime,
	isPlaying,
	speedRegions,
	blankSlideRegions = [],
}: AudioTrackPreviewProps) {
	const audioRef = useRef<HTMLAudioElement>(null);

	useEffect(() => {
		const audio = audioRef.current as PitchPreservingMedia | null;
		if (!audio) return;
		audio.preservesPitch = true;
		audio.mozPreservesPitch = true;
		audio.webkitPreservesPitch = true;
	}, []);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const contentMs = clipContentTimeMs(region, currentTime * 1000, blankSlideRegions);
		const sourceTime =
			currentTime * 1000 < region.startMs ? null : getAudioSourceTimeSec(region, contentMs / 1000);
		if (sourceTime === null) {
			audio.pause();
			return;
		}

		audio.volume = Math.min(1, getMediaClipGain(region, contentMs));
		audio.playbackRate = getTimelinePlaybackRate(speedRegions, currentTime);

		const shouldResync =
			!isPlaying || audio.paused || Math.abs(audio.currentTime - sourceTime) > 0.12;
		if (shouldResync && Number.isFinite(sourceTime)) {
			try {
				audio.currentTime = sourceTime;
			} catch {
				// Metadata may still be loading; the next timeline update retries the seek.
			}
		}

		if (isPlaying && !isSourcePausedAt(currentTime * 1000, blankSlideRegions)) {
			void audio.play().catch(() => undefined);
		} else {
			audio.pause();
		}
	}, [currentTime, isPlaying, region, speedRegions, blankSlideRegions]);

	useEffect(() => {
		return () => audioRef.current?.pause();
	}, []);

	return <audio ref={audioRef} src={sourceUrl} preload="auto" aria-hidden="true" />;
}
