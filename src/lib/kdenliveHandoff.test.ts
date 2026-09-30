import { describe, expect, it } from "vitest";
import { createKdenliveHandoff, normalizeKdenliveMediaPath } from "./kdenliveHandoff";

function producerBlock(xml: string, producerId: string) {
	const match = xml.match(new RegExp(`<producer id="${producerId}"[\\s\\S]*?</producer>`));
	expect(match, `producer ${producerId} should exist`).toBeTruthy();
	return match![0];
}

function playlistBlock(xml: string, playlistId: string) {
	const match = xml.match(
		new RegExp(`<playlist id="${playlistId}"[\\s\\S]*?((</playlist>)|/>)`),
	);
	expect(match, `playlist ${playlistId} should exist`).toBeTruthy();
	return match![0];
}

function playlistEntries(xml: string, playlistId: string) {
	const block = playlistBlock(xml, playlistId);
	const entries = [
		...block.matchAll(
			/<entry producer="([^"]+)"(?: in="(-?\d+)")?(?: out="(-?\d+)")?/g,
		),
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
		expect(videoEntries).toEqual([
			{ producerId: "producer0", inFrame: 0, outFrame: 299 },
		]);
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
		const tractorTracks = [
			...result.xml.matchAll(/<track([^>]*)\/>/g),
		].map((match) => match[1].trim());
		expect(tractorTracks).toEqual([
			'producer="black_track"',
			'hide="audio" producer="playlist0"',
			'hide="audio" producer="playlist1"',
			'hide="video" producer="playlist2"',
		]);
		expect(result.warnings.some((warning) => warning.includes("webcam"))).toBe(true);
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

		const transitions = [...result.xml.matchAll(/<transition id="transition\d+">([\s\S]*?)<\/transition>/g)].map(
			(match) => match[1],
		);
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
		const entryProducerIds = [
			...result.xml.matchAll(/<entry producer="([^"]+)"/g),
		].map((match) => match[1]);
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
});
