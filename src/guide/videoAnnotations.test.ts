import { describe, expect, it } from "vitest";
import { GUIDE_SCHEMA_VERSION, type GuideSession } from "./contracts";
import { buildGuideVideoAnnotations, buildGuideVideoSpeedRegions } from "./videoAnnotations";

function createSession(): GuideSession {
	return {
		schemaVersion: GUIDE_SCHEMA_VERSION,
		recordingId: "recording-1",
		videoPath: "recording.mp4",
		guidePath: "recording.guide.json",
		outputDir: "recording-guide",
		status: "draft-ready",
		events: [],
		snapshots: [],
		ocrBlocks: [],
		candidates: [
			{
				id: "candidate-1",
				eventId: "event-1",
				timeMs: 1200,
				action: "click",
				targetText: "Settings",
				targetRole: "button",
				position: {
					normalizedX: 0.2,
					normalizedY: 0.25,
					xPercent: 20,
					yPercent: 25,
					description: "top left",
				},
				nearbyText: ["Settings"],
				confidence: 0.91,
			},
		],
		generatedGuide: {
			title: "Guide",
			steps: [
				{
					id: "step-1",
					order: 1,
					title: "Open settings",
					instruction: "Click Settings.",
					sourceCandidateId: "candidate-1",
				},
			],
		},
		createdAt: "2026-06-04T00:00:00.000Z",
		updatedAt: "2026-06-04T00:00:00.000Z",
	};
}

describe("buildGuideVideoAnnotations", () => {
	it("creates caption and pointer annotations from generated guide candidates", () => {
		let id = 1;
		let zIndex = 1;
		const annotations = buildGuideVideoAnnotations(createSession(), {
			nextId: () => `guide-video-${id++}`,
			nextZIndex: () => zIndex++,
		});

		expect(annotations).toHaveLength(3);
		expect(annotations[0]).toMatchObject({
			id: "guide-video-1",
			type: "text",
			startMs: 1200,
			content: "1. Click Settings.",
		});
		expect(annotations[0]?.endMs).toBe(3200);
		expect(annotations[0]?.position.x).toBeGreaterThan(20);
		expect(annotations[1]?.endMs).toBe(3200);
		expect(annotations[1]?.position.x).toBeGreaterThan((annotations[0]?.position.x ?? 0) + 34);
		expect(annotations[1]?.position.y).toBeCloseTo(30.5);
		expect(annotations[1]).toMatchObject({
			id: "guide-video-2",
			type: "magnifier",
			magnifierData: {
				target: { x: 20, y: 25 },
				zoom: 2.2,
				shape: "circle",
				caption: "Settings",
			},
		});
		expect(annotations[2]).toMatchObject({
			id: "guide-video-3",
			type: "figure",
			endMs: 3200,
			figureData: {
				arrowDirection: "left",
				color: "#34B27B",
			},
		});
		expect(annotations[2]?.position.x).toBeGreaterThan(20);
	});

	it("returns an empty list when no draft exists", () => {
		const session = createSession();
		session.generatedGuide = undefined;

		const annotations = buildGuideVideoAnnotations(session, {
			nextId: () => "unused",
			nextZIndex: () => 1,
		});

		expect(annotations).toEqual([]);
	});

	it("creates 0.3x speed regions for two seconds at each guide point", () => {
		let id = 1;
		const speedRegions = buildGuideVideoSpeedRegions(createSession(), {
			nextId: () => `guide-speed-${id++}`,
		});

		expect(speedRegions).toEqual([
			{
				id: "guide-speed-1",
				startMs: 1200,
				endMs: 3200,
				speed: 0.3,
			},
		]);
	});
});
