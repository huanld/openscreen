import { describe, expect, it } from "vitest";
import { GUIDE_SCHEMA_VERSION, type GuideSession } from "./contracts";
import { exportGuideToHtml, exportGuideToMarkdown } from "./exporters";

const session: GuideSession = {
	schemaVersion: GUIDE_SCHEMA_VERSION,
	recordingId: "rec-1",
	videoPath: "/tmp/recording.mp4",
	guidePath: "/tmp/recording.guide.json",
	outputDir: "/tmp/recording-guide",
	status: "draft-ready",
	events: [
		{
			id: "event-1",
			recordingId: "rec-1",
			kind: "click",
			source: "cursor-recording",
			timeMs: 1000,
			normalizedX: 0.25,
			normalizedY: 0.75,
			button: "left",
			createdAt: "now",
		},
	],
	snapshots: [
		{
			id: "snapshot-1",
			eventId: "event-1",
			timeMs: 1500,
			offsetMs: 500,
			path: "/tmp/recording-guide/step-001.png",
			markedPath: "/tmp/recording-guide/step-001-marked.png",
			width: 1280,
			height: 720,
		},
	],
	ocrBlocks: [],
	candidates: [
		{
			id: "candidate-1",
			eventId: "event-1",
			snapshotId: "snapshot-1",
			timeMs: 1000,
			action: "click",
			targetText: "Settings",
			targetRole: "button",
			nearbyText: ["Settings"],
			confidence: 0.9,
		},
	],
	generatedGuide: {
		title: "User guide",
		summary: "A generated guide.",
		steps: [
			{
				id: "guide-step-1",
				order: 1,
				title: "Open Settings",
				instruction: "Click Settings.",
				screenshotPath: "/tmp/recording-guide/step-001.png",
				sourceCandidateId: "candidate-1",
			},
		],
	},
	createdAt: "now",
	updatedAt: "now",
};

describe("guide exporters", () => {
	it("exports markdown with relative screenshot references", () => {
		const markdown = exportGuideToMarkdown(session);

		expect(markdown).toContain("# User guide");
		expect(markdown).toContain("## 1. Open Settings");
		expect(markdown).toContain("](step-001-marked.png)");
	});

	it("exports escaped HTML", () => {
		const html = exportGuideToHtml(session);

		expect(html).toContain("<!doctype html>");
		expect(html).toContain("<h1>User guide</h1>");
		expect(html).toContain('src="step-001-marked.png"');
		expect(html).not.toContain("click-marker");
	});

	it("uses marker snapshots for hotkey events with coordinates", () => {
		const hotkeySession: GuideSession = {
			...session,
			events: [
				{
					...session.events[0],
					kind: "hotkey",
					source: "guide-hotkey",
				},
			],
		};

		const html = exportGuideToHtml(hotkeySession);

		expect(html).toContain('src="step-001-marked.png"');
		expect(html).not.toContain("click-marker");
	});

	it("falls back to the unmarked screenshot when no marker snapshot exists", () => {
		const unmarkedSession: GuideSession = {
			...session,
			snapshots: session.snapshots.map((snapshot) => ({
				...snapshot,
				markedPath: undefined,
			})),
		};

		const markdown = exportGuideToMarkdown(unmarkedSession);

		expect(markdown).toContain("](step-001.png)");
	});
});
