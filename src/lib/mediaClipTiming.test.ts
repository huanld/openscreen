import { describe, expect, it } from "vitest";
import {
	getMediaClipGain,
	getMediaClipSourceTimeMs,
	normalizeMediaClipTiming,
	resizeMediaClipSpan,
	splitMediaClip,
} from "./mediaClipTiming";

const clip = {
	id: "clip",
	startMs: 2000,
	endMs: 8000,
	sourceStartMs: 1000,
	sourceDurationMs: 12000,
	volume: 0.6,
};

describe("media clip editing", () => {
	it("maps the source in point and excludes the end boundary", () => {
		expect(getMediaClipSourceTimeMs(clip, 1999)).toBeNull();
		expect(getMediaClipSourceTimeMs(clip, 2000)).toBe(1000);
		expect(getMediaClipSourceTimeMs(clip, 5000)).toBe(4000);
		expect(getMediaClipSourceTimeMs(clip, 8000)).toBeNull();
	});
	it("moves without restarting or advancing the source", () => {
		expect(resizeMediaClipSpan(clip, { start: 4000, end: 10000 })).toMatchObject({
			startMs: 4000,
			endMs: 10000,
			sourceStartMs: 1000,
		});
	});
	it("trims the head and lets the head extend into available source", () => {
		expect(resizeMediaClipSpan(clip, { start: 4000, end: 8000 })).toMatchObject({
			startMs: 4000,
			sourceStartMs: 3000,
		});
		expect(resizeMediaClipSpan(clip, { start: 0, end: 8000 })).toMatchObject({
			startMs: 1000,
			sourceStartMs: 0,
		});
	});
	it("trims the tail without changing source in and stops at source end", () => {
		expect(resizeMediaClipSpan(clip, { start: 2000, end: 5000 })).toMatchObject({
			endMs: 5000,
			sourceStartMs: 1000,
		});
		expect(resizeMediaClipSpan(clip, { start: 2000, end: 20000 }).endMs).toBe(13000);
	});
	it("splits with continuous source content and no fade at the cut", () => {
		const [left, right] = splitMediaClip(
			{ ...clip, fadeInMs: 500, fadeOutMs: 500 },
			5000,
			"right",
		)!;
		expect(left).toMatchObject({ id: "clip", endMs: 5000, fadeInMs: 500, fadeOutMs: 0 });
		expect(right).toMatchObject({
			id: "right",
			startMs: 5000,
			sourceStartMs: 4000,
			fadeInMs: 0,
			fadeOutMs: 500,
		});
		expect(getMediaClipSourceTimeMs(right, 5000)).toBe(getMediaClipSourceTimeMs(clip, 5000));
		expect(clip.endMs).toBe(8000);
	});
	it("rejects cuts too close to either edge", () => {
		for (const cut of [1000, 2000, 2050, 7950, 8000, 10000])
			expect(splitMediaClip(clip, cut, "right")).toBeNull();
	});
	it("clamps invalid saved offsets and fades to usable source", () => {
		expect(
			normalizeMediaClipTiming({ ...clip, sourceStartMs: 99999, fadeInMs: -2, fadeOutMs: 5000 }),
		).toMatchObject({ sourceStartMs: 11999, endMs: 2001, fadeInMs: 0, fadeOutMs: 0.5 });
		expect(normalizeMediaClipTiming({ ...clip, sourceStartMs: NaN }).sourceStartMs).toBe(0);
	});
	it("preserves legacy playback when optional fields are absent", () => {
		expect(getMediaClipSourceTimeMs({ startMs: 2000, endMs: 4000 }, 2500)).toBe(500);
		expect(getMediaClipGain({ startMs: 2000, endMs: 4000 }, 2500)).toBe(1);
	});
	it("fades in and out at the chosen volume, including silence outside", () => {
		const fading = { ...clip, fadeInMs: 1000, fadeOutMs: 2000 };
		for (const [time, gain] of [
			[1000, 0],
			[2000, 0],
			[2500, 0.3],
			[4000, 0.6],
			[7000, 0.3],
			[8000, 0],
		])
			expect(getMediaClipGain(fading, time)).toBeCloseTo(gain);
		expect(getMediaClipGain({ ...fading, volume: 0 }, 4000)).toBe(0);
	});
});
