import { useEffect, useRef } from "react";
import { getAudioSourceTimeSec, getTimelinePlaybackRate } from "./audioTrack";
import type { AudioRegion, SpeedRegion } from "./types";

interface AudioTrackPreviewProps {
	region: AudioRegion;
	sourceUrl: string;
	currentTime: number;
	isPlaying: boolean;
	speedRegions: SpeedRegion[];
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

		const sourceTime = getAudioSourceTimeSec(region, currentTime);
		if (sourceTime === null) {
			audio.pause();
			return;
		}

		audio.volume = Math.max(0, Math.min(1, region.volume));
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

		if (isPlaying) {
			void audio.play().catch(() => undefined);
		} else {
			audio.pause();
		}
	}, [currentTime, isPlaying, region, speedRegions]);

	useEffect(() => {
		return () => audioRef.current?.pause();
	}, []);

	return <audio ref={audioRef} src={sourceUrl} preload="auto" aria-hidden="true" />;
}
