import { describe, expect, it } from "vitest";
import { createKdenliveHandoff, normalizeKdenliveMediaPath } from "./kdenliveHandoff";

function videoTrack(result: ReturnType<typeof createKdenliveHandoff>) {
	return result.timeline.tracks.children.find((track) => track.name === "Screen Video")!;
}

describe("normalizeKdenliveMediaPath", () => {
	it("normalizes Windows paths without URL-encoding spaces", () => {
		expect(normalizeKdenliveMediaPath("C:\\Recordings\\demo clip.webm")).toBe(
			"C:/Recordings/demo clip.webm",
		);
	});

	it("converts file URLs back to local paths", () => {
		expect(normalizeKdenliveMediaPath("file:///C:/Recordings/demo%20clip.webm")).toBe(
			"C:/Recordings/demo clip.webm",
		);
	});

	it("keeps Windows characters as local-path data for Kdenlive", () => {
		expect(normalizeKdenliveMediaPath("C:\\Users\\Đỗ An\\clip #1%.mp4")).toBe(
			"C:/Users/Đỗ An/clip #1%.mp4",
		);
	});
});

describe("createKdenliveHandoff", () => {
	it("creates canonical OTIO video and audio tracks", () => {
		const result = createKdenliveHandoff({
			name: "Demo",
			screenSourcePath: "C:\\Recordings\\demo.webm",
			durationMs: 10_000,
			frameRate: 30,
		});

		expect(result.timeline.OTIO_SCHEMA).toBe("Timeline.1");
		expect(result.timeline.tracks.OTIO_SCHEMA).toBe("Stack.1");
		expect(result.timeline.tracks.children.map((track) => track.kind)).toEqual(["Video", "Audio"]);
		const clip = videoTrack(result).children[0];
		expect(clip.OTIO_SCHEMA).toBe("Clip.2");
		expect(clip.source_range.start_time.value).toBe(0);
		expect(clip.source_range.duration.value).toBe(300);
		expect(clip.media_references.DEFAULT_MEDIA.target_url).toBe("C:/Recordings/demo.webm");
		expect(() => JSON.parse(result.json)).not.toThrow();
	});

	it("treats trim regions as removed ranges and merges overlap", () => {
		const result = createKdenliveHandoff({
			name: "Cuts",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			trimRegions: [
				{ id: "a", startMs: 2_000, endMs: 4_000 },
				{ id: "b", startMs: 3_000, endMs: 5_000 },
				{ id: "c", startMs: 8_000, endMs: 10_000 },
			],
		});

		expect(
			videoTrack(result).children.map((clip) => [
				clip.source_range.start_time.value,
				clip.source_range.duration.value,
			]),
		).toEqual([
			[0, 20],
			[50, 30],
		]);
	});

	it("splits clips at speed boundaries and adds LinearTimeWarp metadata", () => {
		const result = createKdenliveHandoff({
			name: "Speed",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 6_000,
			frameRate: 10,
			speedRegions: [{ id: "fast", startMs: 2_000, endMs: 4_000, speed: 2 }],
		});

		const clips = videoTrack(result).children;
		expect(clips.map((clip) => clip.source_range.duration.value)).toEqual([20, 20, 20]);
		expect(clips[0].effects).toEqual([]);
		expect(clips[1].effects[0]).toMatchObject({
			OTIO_SCHEMA: "LinearTimeWarp.1",
			time_scalar: 2,
		});
		expect(result.warnings.some((warning) => warning.includes("time-warp"))).toBe(true);
	});

	it("combines cut and speed boundaries deterministically", () => {
		const result = createKdenliveHandoff({
			name: "Golden timeline",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			trimRegions: [
				{ id: "tail-cut", startMs: 7_000, endMs: 8_000 },
				{ id: "head-cut", startMs: 2_000, endMs: 3_000 },
			],
			speedRegions: [
				{ id: "fast", startMs: 3_000, endMs: 5_000, speed: 2 },
				{ id: "slow", startMs: 5_000, endMs: 6_000, speed: 0.5 },
			],
		});

		expect(
			videoTrack(result).children.map((clip) => [
				clip.source_range.start_time.value,
				clip.source_range.duration.value,
				clip.metadata.openscreen,
			]),
		).toEqual([
			[0, 20, expect.objectContaining({ playback_speed: 1 })],
			[30, 20, expect.objectContaining({ playback_speed: 2 })],
			[50, 10, expect.objectContaining({ playback_speed: 0.5 })],
			[60, 10, expect.objectContaining({ playback_speed: 1 })],
			[80, 20, expect.objectContaining({ playback_speed: 1 })],
		]);
	});

	it("adds webcam media as its own video track", () => {
		const result = createKdenliveHandoff({
			name: "Camera",
			screenSourcePath: "C:\\screen.webm",
			webcamSourcePath: "C:\\camera.webm",
			durationMs: 1_000,
		});

		expect(result.timeline.tracks.children.map((track) => track.name)).toEqual([
			"Screen Video",
			"Webcam",
			"Screen Audio",
		]);
		expect(result.warnings.some((warning) => warning.includes("webcam"))).toBe(true);
	});

	it("maps effect markers onto the cut-only handoff timeline", () => {
		const result = createKdenliveHandoff({
			name: "Markers",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			trimRegions: [{ id: "cut", startMs: 2_000, endMs: 4_000 }],
			zoomRegions: [{ id: "zoom", startMs: 5_000, endMs: 6_000, depth: 2 }],
			annotationRegions: [
				{
					id: "note",
					startMs: 3_000,
					endMs: 5_000,
					type: "text",
					content: "Review this",
				},
			],
		});

		expect(
			result.timeline.tracks.markers.map((marker) => [
				marker.name,
				marker.marked_range.start_time.value,
			]),
		).toEqual([
			["OpenScreen annotation (text)", 20],
			["OpenScreen zoom", 30],
		]);
	});

	it("rejects a timeline with no retained media", () => {
		expect(() =>
			createKdenliveHandoff({
				name: "Empty",
				screenSourcePath: "C:\\demo.webm",
				durationMs: 1_000,
				trimRegions: [{ id: "all", startMs: 0, endMs: 1_000 }],
			}),
		).toThrow("entire source video is trimmed out");
	});

	it("rejects overlapping speed regions instead of choosing one implicitly", () => {
		expect(() =>
			createKdenliveHandoff({
				name: "Overlap",
				screenSourcePath: "C:\\demo.webm",
				durationMs: 5_000,
				speedRegions: [
					{ id: "first", startMs: 1_000, endMs: 3_000, speed: 2 },
					{ id: "second", startMs: 2_000, endMs: 4_000, speed: 0.5 },
				],
			}),
		).toThrow("Speed regions must not overlap");
	});

	it("rejects non-finite region data before serialization", () => {
		expect(() =>
			createKdenliveHandoff({
				name: "Invalid",
				screenSourcePath: "C:\\demo.webm",
				durationMs: 5_000,
				trimRegions: [{ id: "bad", startMs: Number.NaN, endMs: 1_000 }],
			}),
		).toThrow("non-finite time range");
	});

	it("emits only schemas understood by OpenTimelineIO 0.18.1", () => {
		const result = createKdenliveHandoff({
			name: "Schemas",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 2_000,
			frameRate: 30,
			speedRegions: [{ id: "speed", startMs: 0, endMs: 1_000, speed: 2 }],
			zoomRegions: [{ id: "zoom", startMs: 1_000, endMs: 2_000 }],
		});
		const schemas = new Set<string>();
		const visit = (value: unknown) => {
			if (!value || typeof value !== "object") return;
			if ("OTIO_SCHEMA" in value && typeof value.OTIO_SCHEMA === "string") {
				schemas.add(value.OTIO_SCHEMA);
			}
			for (const child of Object.values(value)) visit(child);
		};
		visit(result.timeline);

		expect([...schemas].sort()).toEqual(
			[
				"Clip.2",
				"ExternalReference.1",
				"LinearTimeWarp.1",
				"Marker.2",
				"RationalTime.1",
				"Stack.1",
				"TimeRange.1",
				"Timeline.1",
				"Track.1",
			].sort(),
		);
	});
});
