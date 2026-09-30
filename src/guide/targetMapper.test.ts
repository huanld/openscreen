import { describe, expect, it } from "vitest";
import { GUIDE_SCHEMA_VERSION, type GuideSession } from "./contracts";
import { buildGuideStepCandidates } from "./targetMapper";

function createSession(): GuideSession {
	return {
		schemaVersion: GUIDE_SCHEMA_VERSION,
		recordingId: "rec-1",
		videoPath: "/tmp/recording.mp4",
		guidePath: "/tmp/recording.guide.json",
		outputDir: "/tmp/recording-guide",
		status: "ocr-ready",
		events: [
			{
				id: "event-1",
				recordingId: "rec-1",
				kind: "click",
				source: "cursor-recording",
				timeMs: 1000,
				normalizedX: 0.5,
				normalizedY: 0.5,
				createdAt: "now",
			},
		],
		snapshots: [
			{
				id: "snapshot-1",
				eventId: "event-1",
				timeMs: 1200,
				offsetMs: 200,
				path: "/tmp/recording-guide/step-001.png",
				width: 1000,
				height: 800,
			},
		],
		ocrBlocks: [
			{
				id: "ocr-1",
				snapshotId: "snapshot-1",
				text: "Save",
				confidence: 0.94,
				box: { x: 0.44, y: 0.46, width: 0.14, height: 0.07 },
			},
			{
				id: "ocr-2",
				snapshotId: "snapshot-1",
				text: "Settings",
				confidence: 0.9,
				box: { x: 0.1, y: 0.1, width: 0.18, height: 0.06 },
			},
		],
		candidates: [],
		createdAt: "now",
		updatedAt: "now",
	};
}

describe("buildGuideStepCandidates", () => {
	it("selects OCR text near the recorded click", () => {
		const candidates = buildGuideStepCandidates(createSession());

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			eventId: "event-1",
			action: "click",
			targetText: "Save",
			targetRole: "button",
			snapshotId: "snapshot-1",
		});
		expect(candidates[0]?.nearbyText).toEqual(["Save", "Settings"]);
		expect(candidates[0]?.confidence).toBeGreaterThan(0.8);
	});

	it("uses manual labels when OCR is not available", () => {
		const session = createSession();
		session.events[0] = {
			...session.events[0],
			kind: "manual",
			source: "review-ui",
			label: "Open report",
		};
		session.ocrBlocks = [];

		const candidates = buildGuideStepCandidates(session);

		expect(candidates[0]).toMatchObject({
			action: "manual",
			targetText: "Open report",
			confidence: 0.75,
		});
	});

	it("treats hotkey markers with coordinates like clicks", () => {
		const session = createSession();
		session.events[0] = {
			...session.events[0],
			kind: "hotkey",
			source: "guide-hotkey",
			normalizedX: 0.5,
			normalizedY: 0.5,
			label: "Ctrl+F12 marker",
		};

		const candidates = buildGuideStepCandidates(session);

		expect(candidates[0]).toMatchObject({
			action: "click",
			targetText: "Save",
			targetRole: "button",
			position: {
				normalizedX: 0.5,
				normalizedY: 0.5,
				xPercent: 50,
				yPercent: 50,
			},
		});
	});

	it("prefers a nearby line phrase over a single OCR word", () => {
		const session = createSession();
		session.events[0] = {
			...session.events[0],
			normalizedX: 0.49,
			normalizedY: 0.31,
		};
		session.ocrBlocks = [
			{
				id: "ocr-1",
				snapshotId: "snapshot-1",
				text: "Cho",
				confidence: 0.8,
				box: { x: 0.36, y: 0.3, width: 0.035, height: 0.02 },
			},
			{
				id: "ocr-2",
				snapshotId: "snapshot-1",
				text: "phép",
				confidence: 0.8,
				box: { x: 0.4, y: 0.3, width: 0.04, height: 0.02 },
			},
			{
				id: "ocr-3",
				snapshotId: "snapshot-1",
				text: "điều",
				confidence: 0.8,
				box: { x: 0.445, y: 0.3, width: 0.04, height: 0.02 },
			},
			{
				id: "ocr-4",
				snapshotId: "snapshot-1",
				text: "khiển",
				confidence: 0.8,
				box: { x: 0.49, y: 0.3, width: 0.045, height: 0.02 },
			},
		];

		const candidates = buildGuideStepCandidates(session);

		expect(candidates[0]).toMatchObject({
			targetText: "Cho phép điều khiển",
			targetRole: "unknown",
		});
		expect(candidates[0]?.nearbyText[0]).toBe("Cho phép điều khiển");
	});
});
