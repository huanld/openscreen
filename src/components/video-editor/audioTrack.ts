import { getMediaClipSourceTimeMs } from "@/lib/mediaClipTiming";
import type { AudioRegion, SpeedRegion } from "./types";

export function getAudioSourceTimeSec(region: AudioRegion, timelineTimeSec: number): number | null {
	const sourceMs = getMediaClipSourceTimeMs(region, timelineTimeSec * 1000);
	return sourceMs === null ? null : sourceMs / 1000;
}

export function getTimelinePlaybackRate(speedRegions: SpeedRegion[], timelineTimeSec: number) {
	const timelineMs = timelineTimeSec * 1000;
	return (
		speedRegions.find((region) => timelineMs >= region.startMs && timelineMs < region.endMs)
			?.speed ?? 1
	);
}
