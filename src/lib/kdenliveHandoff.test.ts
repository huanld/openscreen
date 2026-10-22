import { describe, expect, it } from "vitest";
import { createKdenliveHandoff, normalizeKdenliveMediaPath } from "./kdenliveHandoff";

function producerBlock(xml: string, producerId: string) {
	const match = xml.match(new RegExp(`<producer id="${producerId}"[\\s\\S]*?</producer>`));
	expect(match, `producer ${producerId} should exist`).toBeTruthy();
	return match![0];
}

function playlistBlock(xml: string, playlistId: string) {
	const match = xml.match(new RegExp(`<playlist id="${playlistId}"[\\s\\S]*?((</playlist>)|/>)`));
	expect(match, `playlist ${playlistId} should exist`).toBeTruthy();
	return match![0];
}

function playlistEntries(xml: string, playlistId: string) {
	const block = playlistBlock(xml, playlistId);
	const entries = [
		...block.matchAll(/<entry producer="([^"]+)"(?: in="(-?\d+)")?(?: out="(-?\d+)")?/g),
	];
	return entries.map((entry) => ({
		producerId: entry[1],
		inFrame: entry[2] === undefined ? null : Number(entry[2]),
		outFrame: entry[3] === undefined ? null : Number(entry[3]),
	}));
}

function decodeXmlEntities(value: string) {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function tractorGuides(xml: string) {
	const match = xml.match(
		/<property name="kdenlive:sequenceproperties\.guides">([\s\S]*?)<\/property>/,
	);
	expect(match, "guides property should exist").toBeTruthy();
	return JSON.parse(decodeXmlEntities(match![1])) as Array<{ pos: number; comment: string }>;
}

function entryFilters(xml: string, playlistId: string) {
	const block = playlistBlock(xml, playlistId);
	return [...block.matchAll(/<filter id="([^"]+)">([\s\S]*?)<\/filter>/g)].map((match) => ({
		id: match[1],
		body: match[2],
	}));
}

function filterRect(body: string) {
	const match = body.match(/<property name="rect">([^<]+)<\/property>/);
	expect(match, "filter should carry an animated rect").toBeTruthy();
	return match![1];
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
	it("creates a native kdenlive document with video and audio tracks", () => {
		const result = createKdenliveHandoff({
			name: "Demo",
			screenSourcePath: "C:\\Recordings\\demo.webm",
			durationMs: 10_000,
			frameRate: 30,
		});

		expect(result.xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
		expect(result.xml).toContain('<mlt LC_NUMERIC="C"');
		expect(result.xml).toContain('producer="main_bin"');
		expect(result.xml).toContain('description="automatic" width="1920" height="1080"');
		expect(result.xml).toContain('display_aspect_num="16" display_aspect_den="9"');
		expect(result.xml).toContain('frame_rate_num="30000" frame_rate_den="1000"');
		expect(result.xml).toContain('<property name="kdenlive:docproperties.version">1.04</property>');
		expect(result.xml.trim().endsWith("</mlt>")).toBe(true);

		const screen = producerBlock(result.xml, "producer0");
		expect(screen).toContain('<property name="mlt_service">avformat-novalidate</property>');
		expect(screen).toContain('<property name="resource">C:/Recordings/demo.webm</property>');
		expect(screen).toContain('<property name="length">300</property>');
		expect(screen).toContain('<property name="kdenlive:id">1</property>');

		// Screen video and its audio twin share the same cut points.
		const videoEntries = playlistEntries(result.xml, "playlist0");
		const audioEntries = playlistEntries(result.xml, "playlist1");
		expect(videoEntries).toEqual([{ producerId: "producer0", inFrame: 0, outFrame: 299 }]);
		expect(audioEntries).toEqual(videoEntries);
		expect(playlistBlock(result.xml, "playlist1")).toContain(
			'<property name="kdenlive:audio_track">1</property>',
		);
		expect(result.segmentCount).toBe(1);
	});

	it("uses the source video dimensions for the MLT profile", () => {
		const result = createKdenliveHandoff({
			name: "QHD",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 1_000,
			frameRate: 30,
			screenWidth: 2560,
			screenHeight: 1440,
		});

		expect(result.xml).toContain('width="2560" height="1440"');
		expect(result.xml).toContain('display_aspect_num="16" display_aspect_den="9"');
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

		expect(playlistEntries(result.xml, "playlist0")).toEqual([
			{ producerId: "producer0", inFrame: 0, outFrame: 19 },
			{ producerId: "producer0", inFrame: 50, outFrame: 79 },
		]);
	});

	it("splits clips at speed boundaries and emits timewarp producers", () => {
		const result = createKdenliveHandoff({
			name: "Speed",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 6_000,
			frameRate: 10,
			speedRegions: [{ id: "fast", startMs: 2_000, endMs: 4_000, speed: 2 }],
		});

		expect(playlistEntries(result.xml, "playlist0")).toEqual([
			{ producerId: "producer0", inFrame: 0, outFrame: 19 },
			{ producerId: "producer1", inFrame: 10, outFrame: 19 },
			{ producerId: "producer0", inFrame: 40, outFrame: 59 },
		]);

		const warp = producerBlock(result.xml, "producer1");
		expect(warp).toContain('<property name="mlt_service">timewarp</property>');
		expect(warp).toContain('<property name="warp_speed">2</property>');
		expect(warp).toContain('<property name="resource">2:C:/demo.webm</property>');
		expect(warp).toContain('<property name="warp_resource">2:C:/demo.webm</property>');
		expect(warp).toContain('<property name="kdenlive:id">1</property>');
		expect(result.warnings.some((warning) => warning.includes("guides"))).toBe(true);
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

		expect(playlistEntries(result.xml, "playlist0")).toEqual([
			{ producerId: "producer0", inFrame: 0, outFrame: 19 },
			{ producerId: "producer1", inFrame: 15, outFrame: 24 },
			{ producerId: "producer2", inFrame: 100, outFrame: 119 },
			{ producerId: "producer0", inFrame: 60, outFrame: 69 },
			{ producerId: "producer0", inFrame: 80, outFrame: 99 },
		]);
	});

	it("adds webcam media as its own video track above the screen", () => {
		const result = createKdenliveHandoff({
			name: "Camera",
			screenSourcePath: "C:\\screen.webm",
			webcamSourcePath: "C:\\camera.webm",
			durationMs: 1_000,
		});

		expect(producerBlock(result.xml, "producer1")).toContain(
			'<property name="resource">C:/camera.webm</property>',
		);
		expect(producerBlock(result.xml, "producer1")).toContain(
			'<property name="kdenlive:id">2</property>',
		);

		// MLT stacks bottom-to-top: background, screen, webcam, audio last.
		const tractorTracks = [...result.xml.matchAll(/<track([^>]*)\/>/g)].map((match) =>
			match[1].trim(),
		);
		expect(tractorTracks).toEqual([
			'producer="black_track"',
			'hide="audio" producer="playlist0"',
			'hide="audio" producer="playlist1"',
			'hide="video" producer="playlist2"',
		]);
		expect(result.warnings.some((warning) => warning.includes("webcam"))).toBe(true);
	});

	it("adds the overlay PNG sequence as the topmost video track", () => {
		const result = createKdenliveHandoff({
			name: "Overlay",
			screenSourcePath: "C:\\screen.webm",
			webcamSourcePath: "C:\\camera.webm",
			durationMs: 2_000,
			frameRate: 10,
			overlay: {
				resource: "C:\\demo\\OpenScreen-overlay\\overlay_%06d.png",
				frameCount: 20,
			},
		});

		const overlayProducer = producerBlock(result.xml, "producer_overlay");
		expect(overlayProducer).toContain(
			'<property name="resource">C:/demo/OpenScreen-overlay/overlay_%06d.png</property>',
		);
		expect(overlayProducer).toContain('<property name="ttl">1</property>');
		expect(overlayProducer).toContain('<property name="mlt_service">qimage</property>');
		expect(overlayProducer).toContain('<property name="length">20</property>');

		// Bottom-to-top: background, screen, webcam, overlay, audio.
		const tractorTracks = [...result.xml.matchAll(/<track([^>]*)\/>/g)].map((match) =>
			match[1].trim(),
		);
		expect(tractorTracks).toEqual([
			'producer="black_track"',
			'hide="audio" producer="playlist0"',
			'hide="audio" producer="playlist1"',
			'hide="audio" producer="playlist2"',
			'hide="video" producer="playlist3"',
		]);
		expect(playlistEntries(result.xml, "playlist2")).toEqual([
			{ producerId: "producer_overlay", inFrame: 0, outFrame: 19 },
		]);
		// The overlay track gets its own compositing transition above everything.
		expect(result.xml).toContain('producer="playlist3"');
		expect(result.warnings.some((warning) => warning.includes("overlay"))).toBe(true);
	});

	it("keeps a single video track pair when no webcam or overlay is present", () => {
		const result = createKdenliveHandoff({
			name: "Simple",
			screenSourcePath: "C:\\screen.webm",
			durationMs: 1_000,
		});
		const tractorTracks = [...result.xml.matchAll(/<track([^>]*)\/>/g)].map((match) =>
			match[1].trim(),
		);
		expect(tractorTracks).toEqual([
			'producer="black_track"',
			'hide="audio" producer="playlist0"',
			'hide="video" producer="playlist1"',
		]);
	});

	it("clamps a mismatched overlay frame count to the timeline and warns", () => {
		const result = createKdenliveHandoff({
			name: "Drift",
			screenSourcePath: "C:\\screen.webm",
			durationMs: 1_000,
			frameRate: 10,
			overlay: { resource: "C:\\seq\\overlay_%06d.png", frameCount: 30 },
		});
		expect(producerBlock(result.xml, "producer_overlay")).toContain(
			'<property name="length">10</property>',
		);
		expect(result.warnings.some((warning) => warning.includes("30 frames"))).toBe(true);
	});

	it("maps effect regions onto timeline guides", () => {
		const result = createKdenliveHandoff({
			name: "Guides",
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

		expect(tractorGuides(result.xml)).toEqual([
			{ pos: 20, comment: "OpenScreen annotation (text): Review this", type: 0, duration: 0 },
			{ pos: 30, comment: "OpenScreen zoom (preset 2)", type: 0, duration: 0 },
		]);
	});

	it("wires kdenlive transitions for audio mixing and video compositing", () => {
		const result = createKdenliveHandoff({
			name: "Transitions",
			screenSourcePath: "C:\\demo.webm",
			webcamSourcePath: "C:\\camera.webm",
			durationMs: 1_000,
		});

		const transitions = [
			...result.xml.matchAll(/<transition id="transition\d+">([\s\S]*?)<\/transition>/g),
		].map((match) => match[1]);
		const serviceOf = (block: string) =>
			block.match(/<property name="mlt_service">([^<]+)<\/property>/)![1];
		const bTrackOf = (block: string) =>
			block.match(/<property name="b_track">(\d+)<\/property>/)![1];

		// Audio track (MLT index 3) mixes; both video tracks composite over black.
		expect(transitions.map((block) => `${serviceOf(block)}@${bTrackOf(block)}`)).toEqual([
			"qtblend@1",
			"qtblend@2",
			"mix@3",
		]);
		expect(result.xml).toContain('global_feed="1"');
	});

	it("only references producers that exist in the document", () => {
		const result = createKdenliveHandoff({
			name: "Refs",
			screenSourcePath: "C:\\demo.webm",
			webcamSourcePath: "C:\\camera.webm",
			durationMs: 6_000,
			frameRate: 10,
			speedRegions: [{ id: "fast", startMs: 2_000, endMs: 4_000, speed: 2 }],
		});

		const producerIds = [...result.xml.matchAll(/<producer id="([^"]+)"/g)].map(
			(match) => match[1],
		);
		const entryProducerIds = [...result.xml.matchAll(/<entry producer="([^"]+)"/g)].map(
			(match) => match[1],
		);
		for (const entryProducerId of entryProducerIds) {
			expect(producerIds).toContain(entryProducerId);
		}
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

	it("escapes XML-significant characters in media paths and guides", () => {
		const result = createKdenliveHandoff({
			name: "Escapes",
			screenSourcePath: 'C:\\Recordings\\demo & "take 1".webm',
			durationMs: 1_000,
			annotationRegions: [
				{ id: "note", startMs: 0, endMs: 500, type: "text", content: "<b>bold</b>" },
			],
		});

		expect(result.xml).toContain("demo &amp; &quot;take 1&quot;.webm");
		expect(result.xml).toContain("&lt;b&gt;bold&lt;/b&gt;");
	});

	it("exports a manual zoom region as keyframed qtblend filters on the screen track", () => {
		const result = createKdenliveHandoff({
			name: "Zoom",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			zoomRegions: [
				{
					id: "z",
					startMs: 5_000,
					endMs: 6_000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
					focusMode: "manual",
				},
			],
		});

		const filters = entryFilters(result.xml, "playlist0");
		expect(filters).toHaveLength(1);
		expect(filters[0].id).toBe("zoom_0_0");
		expect(filters[0].body).toContain('<property name="mlt_service">qtblend</property>');
		expect(filters[0].body).toContain('<property name="kdenlive_id">qtblend</property>');

		const rect = filterRect(filters[0].body);
		// 0.4s ease at 10fps = 4 frames: full frame at 46, zoomed hold 50-60, full again at 64.
		expect(rect).toContain("46=0% 0% 100% 100% 1");
		expect(rect).toContain("50=16.67% 16.67% 66.67% 66.67% 1");
		expect(rect).toContain("64=0% 0% 100% 100% 1");

		// Only the screen video track zooms; the audio twin stays untouched.
		expect(entryFilters(result.xml, "playlist1")).toHaveLength(0);
		expect(tractorGuides(result.xml)).toContainEqual({
			pos: 50,
			comment: "OpenScreen zoom (preset 2)",
			type: 0,
			duration: 0,
		});
	});

	it("follows cursor telemetry for auto-focus zoom regions", () => {
		const result = createKdenliveHandoff({
			name: "Auto zoom",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			zoomRegions: [{ id: "z", startMs: 2_000, endMs: 8_000, depth: 2, focusMode: "auto" }],
			cursorSamples: [
				{ tMs: 0, cx: 0.1, cy: 0.1 },
				{ tMs: 5_000, cx: 0.9, cy: 0.9 },
				{ tMs: 10_000, cx: 0.9, cy: 0.9 },
			],
		});

		const filters = entryFilters(result.xml, "playlist0");
		expect(filters).toHaveLength(1);
		const rect = filterRect(filters[0].body);
		// Focus at region start interpolates to cx=0.42 (rect x=8.67%); by the end the
		// cursor rests at 0.9, clamped to the depth boundary (rect x=33.33%).
		expect(rect).toContain("20=8.67% 8.67% 66.67% 66.67% 1");
		expect(rect).toContain("80=33.33% 33.33% 66.67% 66.67% 1");
	});

	it("places zoom keyframes through speed-warped timeline positions", () => {
		const result = createKdenliveHandoff({
			name: "Warp zoom",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 6_000,
			frameRate: 10,
			speedRegions: [{ id: "fast", startMs: 2_000, endMs: 4_000, speed: 2 }],
			zoomRegions: [
				{
					id: "z",
					startMs: 4_500,
					endMs: 5_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
					focusMode: "manual",
				},
			],
		});

		// Source frames 45-55 map to timeline 35-45 after the 2x segment compresses
		// frames 20-40 into timeline 20-30.
		expect(tractorGuides(result.xml)).toContainEqual({
			pos: 35,
			comment: "OpenScreen zoom (preset 2)",
			type: 0,
			duration: 0,
		});

		const filters = entryFilters(result.xml, "playlist0");
		expect(filters).toHaveLength(1);
		expect(filters[0].id).toBe("zoom_0_2");
		// Third clip starts at timeline 30, so the zoom-in begins at local frame 5.
		expect(filterRect(filters[0].body)).toContain("5=16.67% 16.67% 66.67% 66.67% 1");
	});

	it("keeps zoom filters continuous across a trim split", () => {
		const result = createKdenliveHandoff({
			name: "Split zoom",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 10_000,
			frameRate: 10,
			trimRegions: [{ id: "cut", startMs: 4_000, endMs: 6_000 }],
			zoomRegions: [
				{
					id: "z",
					startMs: 3_500,
					endMs: 6_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
					focusMode: "manual",
				},
			],
		});

		const filters = entryFilters(result.xml, "playlist0");
		expect(filters).toHaveLength(2);
		const firstRect = filterRect(filters[0].body);
		const secondRect = filterRect(filters[1].body);
		// First clip eases in, then holds zoomed to its last frame (timeline 35-40;
		// timeline 40 is the clip boundary so it clamps to local frame 39).
		expect(firstRect).toContain("31=0% 0% 100% 100% 1");
		expect(firstRect).toContain("39=16.67% 16.67% 66.67% 66.67% 1");
		// Second clip resumes already zoomed at its start (timeline 40 = local 0).
		expect(secondRect.startsWith("0=16.67% 16.67% 66.67% 66.67% 1;")).toBe(true);
		// ...and eases back out before the clip ends (timeline 45-49 = local 5-9).
		expect(secondRect).toContain("9=0% 0% 100% 100% 1");
	});

	it("skips the zoom filter for scale-1 regions while keeping the guide", () => {
		const result = createKdenliveHandoff({
			name: "No zoom",
			screenSourcePath: "C:\\demo.webm",
			durationMs: 5_000,
			frameRate: 10,
			zoomRegions: [{ id: "z", startMs: 1_000, endMs: 2_000, customScale: 1, focusMode: "manual" }],
		});

		expect(entryFilters(result.xml, "playlist0")).toHaveLength(0);
		expect(
			tractorGuides(result.xml).some((guide) => guide.comment.includes("OpenScreen zoom")),
		).toBe(true);
	});
});
