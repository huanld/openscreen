import { describe, expect, it } from "vitest";
import { getAudioSourceTimeSec, getTimelinePlaybackRate } from "./audioTrack";

describe("audio track timing", () => {
	const region = {
		id: "audio-1",
		startMs: 2000,
		endMs: 7000,
		sourcePath: "/music/theme.mp3",
		name: "theme.mp3",
		volume: 1,
	};

	it("maps source-video time to the imported clip", () => {
		expect(getAudioSourceTimeSec(region, 1.9)).toBeNull();
		expect(getAudioSourceTimeSec(region, 2)).toBe(0);
		expect(getAudioSourceTimeSec(region, 4.5)).toBe(2.5);
		expect(getAudioSourceTimeSec(region, 7)).toBeNull();
	});

	it("uses the speed region active at the source-video time", () => {
		const speedRegions = [{ id: "speed-1", startMs: 1000, endMs: 3000, speed: 2 as const }];
		expect(getTimelinePlaybackRate(speedRegions, 0.5)).toBe(1);
		expect(getTimelinePlaybackRate(speedRegions, 2)).toBe(2);
	});
});
