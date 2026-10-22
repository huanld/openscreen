import { afterEach, describe, expect, it, vi } from "vitest";
import { createInsertedSlidePlayback } from "./insertedSlidePlayback";

function setup() {
	let callback: FrameRequestCallback | null = null;
	let wallMs = 0;
	vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
		callback = next;
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {
		callback = null;
	});
	vi.spyOn(performance, "now").mockImplementation(() => wallMs);
	const video = {
		duration: 3,
		currentTime: 0,
		paused: true,
		playbackRate: 1,
		ended: false,
		play: vi.fn(async () => {
			video.paused = false;
		}),
		pause: vi.fn(() => {
			video.paused = true;
		}),
	};
	const currentTimeRef = { current: 0 };
	const isPlayingRef = { current: false };
	const allowPlaybackRef = { current: false };
	const params = {
		video: video as unknown as HTMLVideoElement,
		currentTimeRef,
		isPlayingRef,
		allowPlaybackRef,
		blankSlideRegionsRef: {
			current: [{ id: "slide", startMs: 500, endMs: 1500, backgroundColor: "#fff" }],
		},
		trimRegionsRef: { current: [] as { id: string; startMs: number; endMs: number }[] },
		speedRegionsRef: {
			current: [] as { id: string; startMs: number; endMs: number; speed: number }[],
		},
		isSeekingRef: { current: false },
		onTimeUpdate: vi.fn(),
		onPlayStateChange: vi.fn(),
	};
	const controller = createInsertedSlidePlayback(params);
	const tick = async (elapsed: number, sourceTime?: number) => {
		wallMs += elapsed;
		if (sourceTime !== undefined) video.currentTime = sourceTime;
		const next = callback;
		callback = null;
		next?.(wallMs);
		await Promise.resolve();
	};
	return { video, controller, params, tick };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("slide insertion preview clock", () => {
	it("uses validated source duration when the browser still reports Infinity", () => {
		const { controller, params, video } = setup();
		controller.destroy();
		video.duration = Infinity;
		const resolved = createInsertedSlidePlayback({ ...params, getSourceDurationSec: () => 3 });
		resolved.seek(3.2);
		expect(params.currentTimeRef.current).toBe(3200);
		expect(video.currentTime).toBe(2.2);
		resolved.destroy();
	});
	it("pauses at the boundary, advances the slide, then resumes the same source frame", async () => {
		const { controller, params, video, tick } = setup();
		await controller.play();
		await tick(520, 0.52);
		expect(params.currentTimeRef.current).toBe(500);
		expect(video.currentTime).toBe(0.5);
		expect(video.paused).toBe(true);
		controller.handlePause();
		expect(params.isPlayingRef.current).toBe(true);
		await tick(600);
		expect(params.currentTimeRef.current).toBe(1100);
		expect(video.currentTime).toBe(0.5);
		await tick(400);
		expect(params.currentTimeRef.current).toBe(1500);
		expect(video.paused).toBe(false);
		await tick(100, 0.6);
		expect(params.currentTimeRef.current).toBe(1600);
		await tick(2400, 3);
		expect(params.currentTimeRef.current).toBe(4000);
		expect(params.isPlayingRef.current).toBe(false);
		controller.destroy();
	});
	it("seeks and pauses inside a slide without advancing the underlying source", async () => {
		const { controller, params, video, tick } = setup();
		controller.seek(1.2);
		expect(video.currentTime).toBe(0.5);
		controller.handleSeeking();
		controller.handleSeeked();
		expect(params.currentTimeRef.current).toBe(1200);
		await controller.play();
		await tick(100);
		controller.pause();
		await tick(1000);
		expect(params.currentTimeRef.current).toBe(1300);
		await controller.play();
		await tick(200);
		expect(params.currentTimeRef.current).toBe(1500);
		expect(video.currentTime).toBe(0.5);
		controller.seek(3.2);
		expect(video.currentTime).toBe(2.2);
		controller.destroy();
	});
	it("skips a trimmed slide interval and applies speed without changing the held frame", async () => {
		const { controller, params, video, tick } = setup();
		params.trimRegionsRef.current = [{ id: "trim", startMs: 700, endMs: 1100 }];
		params.speedRegionsRef.current = [{ id: "speed", startMs: 500, endMs: 1500, speed: 2 }];
		controller.seek(0.5);
		await controller.play();
		await tick(100);
		expect(params.currentTimeRef.current).toBe(1100);
		expect(video.currentTime).toBe(0.5);
		await tick(200);
		expect(params.currentTimeRef.current).toBe(1500);
		controller.destroy();
	});
});
