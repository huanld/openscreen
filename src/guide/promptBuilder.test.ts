import { describe, expect, it } from "vitest";
import { GUIDE_SCHEMA_VERSION, type GuideSession, type GuideStepCandidate } from "./contracts";
import { buildGuideDraftPrompt, buildLocalGuideDraft } from "./promptBuilder";

const session: GuideSession = {
	schemaVersion: GUIDE_SCHEMA_VERSION,
	recordingId: "rec-1",
	videoPath: "/tmp/recording.mp4",
	guidePath: "/tmp/recording.guide.json",
	outputDir: "/tmp/recording-guide",
	status: "ocr-ready",
	events: [],
	snapshots: [
		{
			id: "snapshot-1",
			eventId: "event-1",
			timeMs: 1500,
			offsetMs: 500,
			path: "/tmp/recording-guide/step-001.png",
			width: 1280,
			height: 720,
		},
	],
	ocrBlocks: [],
	candidates: [],
	createdAt: "now",
	updatedAt: "now",
};

const candidates: GuideStepCandidate[] = [
	{
		id: "candidate-1",
		eventId: "event-1",
		snapshotId: "snapshot-1",
		timeMs: 1000,
		action: "click",
		targetText: "Save",
		targetRole: "button",
		position: {
			normalizedX: 0.5,
			normalizedY: 0.5,
			xPercent: 50,
			yPercent: 50,
			description: "center",
		},
		nearbyText: ["Save"],
		confidence: 0.9,
	},
];

describe("guide draft helpers", () => {
	it("builds a strict JSON prompt for AI providers", () => {
		const prompt = buildGuideDraftPrompt({ session, candidates, language: "en" });

		expect(prompt).toContain("Return JSON only");
		expect(prompt).toContain('"sourceCandidateId": "candidate-1"');
		expect(prompt).toContain('"targetText": "Save"');
		expect(prompt).toContain('"xPercent": 50');
		expect(prompt).toContain('"id":"guide-step-1"');
	});

	it("builds a deterministic local guide draft", () => {
		const guide = buildLocalGuideDraft(session, candidates, "en");

		expect(guide.title).toBe("User guide");
		expect(guide.steps[0]).toMatchObject({
			id: "guide-step-1",
			order: 1,
			title: "Step 1: Save",
			instruction: 'Click "Save".',
			screenshotPath: "/tmp/recording-guide/step-001.png",
		});
	});
});
