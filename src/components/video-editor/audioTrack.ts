import type { AudioRegion, SpeedRegion } from "./types";

export function getAudioSourceTimeSec(region: AudioRegion, timelineTimeSec: number): number | null {
	const timelineMs = timelineTimeSec * 1000;
	if (timelineMs < region.startMs || timelineMs >= region.endMs) return null;
	return Math.max(0, (timelineMs - region.startMs) / 1000);
}

export function getTimelinePlaybackRate(speedRegions: SpeedRegion[], timelineTimeSec: number) {
	const timelineMs = timelineTimeSec * 1000;
	return (
		speedRegions.find((region) => timelineMs >= region.startMs && timelineMs < region.endMs)
			?.speed ?? 1
	);
}
