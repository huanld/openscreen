import { describe, expect, it } from "vitest";
import { GUIDE_SCHEMA_VERSION, type GuideSession } from "./contracts";
import {
	buildGuideVideoAnnotations,
	buildGuideVideoSpeedRegions,
	replaceGuideVideoAnnotations,
} from "./videoAnnotations";

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
			type: "rectangle",
			startMs: 1200,
			position: { x: 8, y: 16 },
			size: { width: 24, height: 18 },
			figureData: { color: "#ef4444", strokeWidth: 4 },
			guideRecordingId: "recording-1",
			guideNodeId: "candidate-1",
			guideRole: "rectangle",
		});
		expect(annotations[0]?.endMs).toBe(3200);
		expect(annotations[1]?.endMs).toBe(3200);
		expect(annotations[1]).toMatchObject({
			id: "guide-video-2",
			type: "text",
			content: "1. Click Settings.",
			guideRole: "text",
		});
		expect(annotations[1]?.position.x).toBeGreaterThan(20);
		expect(annotations[2]).toMatchObject({
			id: "guide-video-3",
			type: "figure",
			endMs: 3200,
			figureData: {
				arrowDirection: "left",
				color: "#34B27B",
			},
			guideRole: "arrow",
		});
		expect(annotations[2]?.position.x).toBeGreaterThan(20);
	});

	it("creates only one rectangle, arrow and text when guide steps reuse one OCR node", () => {
		const session = createSession();
		session.generatedGuide?.steps.push({
			id: "step-duplicate",
			order: 2,
			title: "Duplicate",
			instruction: "Duplicate instruction.",
			sourceCandidateId: "candidate-1",
		});
		let id = 1;
		const annotations = buildGuideVideoAnnotations(session, {
			nextId: () => `guide-video-${id++}`,
			nextZIndex: () => id,
		});

		expect(annotations).toHaveLength(3);
		expect(annotations.map((annotation) => annotation.guideRole)).toEqual([
			"rectangle",
			"text",
			"arrow",
		]);
	});

	it("ends one OCR annotation set before the next nearby event begins", () => {
		const session = createSession();
		session.candidates.push({
			id: "candidate-2",
			eventId: "event-2",
			timeMs: 1500,
			action: "click",
			targetText: "Reports",
			targetRole: "button",
			position: {
				normalizedX: 0.75,
				normalizedY: 0.7,
				xPercent: 75,
				yPercent: 70,
				description: "bottom right",
			},
			nearbyText: ["Reports"],
			confidence: 0.9,
		});
		session.generatedGuide?.steps.push({
			id: "step-2",
			order: 2,
			title: "Open reports",
			instruction: "Click Reports.",
			sourceCandidateId: "candidate-2",
		});
		let id = 1;
		const annotations = buildGuideVideoAnnotations(session, {
			nextId: () => `guide-video-${id++}`,
			nextZIndex: () => id,
		});

		const firstNode = annotations.filter((annotation) => annotation.guideNodeId === "candidate-1");
		const secondNode = annotations.filter((annotation) => annotation.guideNodeId === "candidate-2");
		expect(firstNode).toHaveLength(3);
		expect(firstNode.every((annotation) => annotation.endMs === 1420)).toBe(true);
		expect(secondNode).toHaveLength(3);
		expect(secondNode.every((annotation) => annotation.startMs === 1500)).toBe(true);
		expect(Math.max(...firstNode.map((annotation) => annotation.endMs))).toBeLessThan(
			Math.min(...secondNode.map((annotation) => annotation.startMs)),
		);
		const speedRegions = buildGuideVideoSpeedRegions(session, {
			nextId: () => `guide-speed-${id++}`,
		});
		expect(speedRegions).toMatchObject([
			{ startMs: 1200, endMs: 1420, guideNodeId: "candidate-1" },
			{ startMs: 1500, endMs: 3500, guideNodeId: "candidate-2" },
		]);
	});

	it("merges rapid repeated events on the same OCR target", () => {
		const session = createSession();
		session.candidates.push({
			...session.candidates[0],
			id: "candidate-2",
			eventId: "event-2",
			timeMs: 1450,
			position: {
				...session.candidates[0].position!,
				normalizedX: 0.205,
				normalizedY: 0.255,
			},
		});
		session.generatedGuide?.steps.push({
			id: "step-2",
			order: 2,
			title: "Open settings again",
			instruction: "Click Settings again.",
			sourceCandidateId: "candidate-2",
		});
		let id = 1;
		const annotations = buildGuideVideoAnnotations(session, {
			nextId: () => `guide-video-${id++}`,
			nextZIndex: () => id,
		});

		expect(annotations).toHaveLength(3);
		expect(new Set(annotations.map((annotation) => annotation.guideNodeId))).toEqual(
			new Set(["candidate-1"]),
		);
	});

	it("sequences different OCR targets captured at the same millisecond", () => {
		const session = createSession();
		session.candidates.push({
			...session.candidates[0],
			id: "candidate-2",
			eventId: "event-2",
			targetText: "Reports",
			position: {
				...session.candidates[0].position!,
				normalizedX: 0.8,
				normalizedY: 0.8,
			},
		});
		session.generatedGuide?.steps.push({
			id: "step-2",
			order: 2,
			title: "Open reports",
			instruction: "Click Reports.",
			sourceCandidateId: "candidate-2",
		});
		let id = 1;
		const rectangles = buildGuideVideoAnnotations(session, {
			nextId: () => `guide-video-${id++}`,
			nextZIndex: () => id,
		}).filter((annotation) => annotation.guideRole === "rectangle");

		expect(rectangles).toMatchObject([
			{ startMs: 1200, endMs: 1201, guideNodeId: "candidate-1" },
			{ startMs: 1202, guideNodeId: "candidate-2" },
		]);
	});

	it("replaces annotations from the same guide recording instead of appending duplicates", () => {
		let id = 1;
		const first = buildGuideVideoAnnotations(createSession(), {
			nextId: () => `first-${id++}`,
			nextZIndex: () => id,
		});
		const second = buildGuideVideoAnnotations(createSession(), {
			nextId: () => `second-${id++}`,
			nextZIndex: () => id,
		});
		const manual = {
			...first[0],
			id: "manual",
			position: { x: 50, y: 50 },
			guideRecordingId: undefined,
		};

		const attached = replaceGuideVideoAnnotations([...first, manual], second, "recording-1");

		expect(attached).toHaveLength(4);
		expect(attached[0]?.id).toBe("manual");
		expect(attached.slice(1)).toEqual(second);
	});

	it("removes duplicate guide annotations made by older app versions", () => {
		let id = 1;
		const generated = buildGuideVideoAnnotations(createSession(), {
			nextId: () => `new-${id++}`,
			nextZIndex: () => id,
		});
		const legacyCopies = generated.flatMap((annotation, copyIndex) => [
			{
				...annotation,
				id: `legacy-${copyIndex}-a`,
				guideRecordingId: undefined,
				guideNodeId: undefined,
				guideRole: undefined,
			},
			{
				...annotation,
				id: `legacy-${copyIndex}-b`,
				guideRecordingId: undefined,
				guideNodeId: undefined,
				guideRole: undefined,
			},
		]);

		const attached = replaceGuideVideoAnnotations(legacyCopies, generated, "recording-1");

		expect(attached).toEqual(generated);
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
				guideRecordingId: "recording-1",
				guideNodeId: "candidate-1",
			},
		]);
	});
});
