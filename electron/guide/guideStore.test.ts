import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuideStore, GuideStoreError } from "./guideStore";

let recordingsDir = "";

beforeEach(async () => {
	recordingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openscreen-guide-"));
});

afterEach(async () => {
	if (recordingsDir) {
		await fs.rm(recordingsDir, { recursive: true, force: true });
	}
});

describe("GuideStore", () => {
	it("creates and reads an empty guide session", async () => {
		const store = new GuideStore(recordingsDir);

		const session = await store.startSession(123);
		const readSession = await store.readSession(123);

		expect(session.recordingId).toBe("123");
		expect(session.status).toBe("recording");
		expect(session.guidePath).toBe(path.join(recordingsDir, "recording-123.guide.json"));
		expect(readSession).toEqual(session);
		await expect(fs.stat(session.outputDir)).resolves.toMatchObject({
			isDirectory: expect.any(Function),
		});
	});

	it("adds marker events in timeline order", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(456);

		await store.addMarker({ recordingId: 456, kind: "manual", timeMs: 2000, label: "Later" });
		const result = await store.addMarker({
			recordingId: 456,
			kind: "hotkey",
			timeMs: 500,
			label: "First",
			normalizedX: 0.25,
			normalizedY: 0.75,
		});

		expect(result.event.kind).toBe("hotkey");
		expect(result.event).toMatchObject({
			x: 0.25,
			y: 0.75,
			normalizedX: 0.25,
			normalizedY: 0.75,
		});
		expect(result.session.events.map((event) => event.timeMs)).toEqual([500, 2000]);
		expect(result.session.events[0]?.source).toBe("guide-hotkey");
		expect(result.session.events[1]?.source).toBe("review-ui");
	});

	it("finalizes a session against the saved video path", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(789);
		const videoPath = path.join(recordingsDir, "recording-789.mp4");
		await fs.writeFile(videoPath, "");

		const session = await store.finalizeEvents({ recordingId: 789, videoPath });

		expect(session.status).toBe("events-ready");
		expect(session.videoPath).toBe(videoPath);
		expect(session.guidePath).toBe(path.join(recordingsDir, "recording-789.guide.json"));
	});

	it("adds cursor click events when finalizing a session", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(790);
		await store.addMarker({ recordingId: 790, kind: "manual", timeMs: 250, label: "Manual" });
		const videoPath = path.join(recordingsDir, "recording-790.mp4");
		await fs.writeFile(videoPath, "");
		await fs.writeFile(
			`${videoPath}.cursor.json`,
			JSON.stringify({
				version: 2,
				provider: "native",
				assets: [],
				samples: [
					{ timeMs: 100, cx: 0.2, cy: 0.3, interactionType: "move" },
					{ timeMs: 200, cx: 0.4, cy: 0.5, interactionType: "click" },
					{ timeMs: 225, cx: 0.401, cy: 0.501, interactionType: "click" },
				],
			}),
			"utf-8",
		);

		const session = await store.finalizeEvents({ recordingId: 790, videoPath });

		expect(session.cursorPath).toBe(`${videoPath}.cursor.json`);
		expect(session.events.map((event) => event.kind)).toEqual(["click", "manual"]);
		expect(session.events[0]).toMatchObject({
			timeMs: 200,
			normalizedX: 0.4,
			normalizedY: 0.5,
		});
	});

	it("rejects guide artifacts outside the recordings directory", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(321);
		const outsideVideoPath = path.join(path.dirname(recordingsDir), "outside.mp4");

		await expect(
			store.finalizeEvents({ recordingId: 321, videoPath: outsideVideoPath }),
		).rejects.toMatchObject({
			code: "guide-invalid-input",
		});
	});

	it("rejects invalid guide session schema", async () => {
		const store = new GuideStore(recordingsDir);
		await fs.writeFile(
			path.join(recordingsDir, "recording-bad.guide.json"),
			JSON.stringify({ schemaVersion: 999 }),
			"utf-8",
		);

		await expect(store.readSession("bad")).rejects.toBeInstanceOf(GuideStoreError);
		await expect(store.readSession("bad")).rejects.toMatchObject({
			code: "guide-invalid-schema",
		});
	});

	it("saves a reviewed generated guide", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(654);

		const session = await store.saveGuide({
			recordingId: 654,
			generatedGuide: {
				title: "Huong dan thao tac",
				steps: [
					{
						id: "step-1",
						order: 1,
						title: "Mo cai dat",
						instruction: "Nhan nut Settings.",
					},
				],
			},
		});

		expect(session.status).toBe("reviewed");
		expect(session.generatedGuide?.steps).toHaveLength(1);
	});

	it("writes snapshots and builds candidates without OCR", async () => {
		const store = new GuideStore(recordingsDir);
		await store.startSession(112);
		await store.addMarker({ recordingId: 112, kind: "manual", timeMs: 500, label: "Save" });
		const videoPath = path.join(recordingsDir, "recording-112.mp4");
		await fs.writeFile(videoPath, "");
		const eventsSession = await store.finalizeEvents({ recordingId: 112, videoPath });

		const session = await store.writeSnapshot({
			recordingId: 112,
			eventId: eventsSession.events[0]?.id ?? "",
			timeMs: 1000,
			offsetMs: 500,
			width: 800,
			height: 600,
			pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
		});

		expect(session.status).toBe("snapshots-ready");
		expect(session.snapshots).toHaveLength(1);
		expect(session.candidates[0]).toMatchObject({ targetText: "Save" });
		await expect(fs.readFile(session.snapshots[0]?.path ?? "")).resolves.toEqual(
			Buffer.from([137, 80, 78, 71]),
		);
	});

	it("runs OCR, generates a local draft, and exports files", async () => {
		const store = new GuideStore(recordingsDir, {
			ocrClient: {
				recognize: async (snapshot) => [
					{
						id: `ocr-${snapshot.id}-1`,
						snapshotId: snapshot.id,
						text: "Save",
						confidence: 0.95,
						box: { x: 0.45, y: 0.45, width: 0.15, height: 0.08 },
					},
				],
			},
		});
		await store.startSession(113);
		const videoPath = path.join(recordingsDir, "recording-113.mp4");
		await fs.writeFile(videoPath, "");
		await fs.writeFile(
			`${videoPath}.cursor.json`,
			JSON.stringify({
				samples: [{ timeMs: 200, cx: 0.5, cy: 0.5, interactionType: "click" }],
			}),
			"utf-8",
		);
		const eventsSession = await store.finalizeEvents({ recordingId: 113, videoPath });
		await store.writeSnapshot({
			recordingId: 113,
			eventId: eventsSession.events[0]?.id ?? "",
			timeMs: 700,
			offsetMs: 500,
			width: 800,
			height: 600,
			pngBytes: new Uint8Array([1, 2, 3]).buffer,
		});

		const ocrSession = await store.runOcr({ recordingId: 113 });
		const draftSession = await store.generateDraft({
			recordingId: 113,
			language: "en",
			provider: "local",
		});
		const markdown = await store.exportMarkdown({ recordingId: 113 });
		const html = await store.exportHtml({ recordingId: 113 });

		expect(ocrSession.candidates[0]).toMatchObject({ targetText: "Save" });
		expect(draftSession.generatedGuide?.steps[0]?.instruction).toBe('Click "Save".');
		await expect(fs.readFile(markdown.path, "utf-8")).resolves.toContain("# User guide");
		await expect(fs.readFile(html.path, "utf-8")).resolves.toContain("<!doctype html>");
	});

	it("repairs generic hotkey marker text and attaches AI draft artifacts", async () => {
		const store = new GuideStore(recordingsDir, {
			ocrClient: {
				recognize: async (snapshot) => [
					{
						id: `ocr-${snapshot.id}-1`,
						snapshotId: snapshot.id,
						text: "Save",
						confidence: 0.95,
						box: { x: 0.45, y: 0.45, width: 0.15, height: 0.08 },
					},
				],
			},
			draftClient: {
				generate: async () => ({
					title: "Guide",
					steps: [
						{
							id: "guide-step-1",
							order: 1,
							title: "Step 1: Click Ctrl+F12 marker",
							instruction: "Click Ctrl+F12 marker.",
						},
					],
				}),
			},
		});
		await store.startSession(114);
		await store.addMarker({
			recordingId: 114,
			kind: "hotkey",
			timeMs: 200,
			label: "Ctrl+F12 marker",
			normalizedX: 0.5,
			normalizedY: 0.5,
		});
		const videoPath = path.join(recordingsDir, "recording-114.mp4");
		await fs.writeFile(videoPath, "");
		const eventsSession = await store.finalizeEvents({ recordingId: 114, videoPath });
		await store.writeSnapshot({
			recordingId: 114,
			eventId: eventsSession.events[0]?.id ?? "",
			timeMs: 700,
			offsetMs: 500,
			width: 800,
			height: 600,
			pngBytes: new Uint8Array([1, 2, 3]).buffer,
		});
		await store.runOcr({ recordingId: 114 });

		const draftSession = await store.generateDraft({
			recordingId: 114,
			language: "en",
			provider: "deepseek",
		});

		expect(draftSession.candidates[0]).toMatchObject({
			targetText: "Save",
			position: { xPercent: 50, yPercent: 50 },
		});
		expect(draftSession.generatedGuide?.steps[0]).toMatchObject({
			title: "Step 1: Save",
			instruction: 'Click "Save".',
			sourceCandidateId: draftSession.candidates[0]?.id,
			screenshotPath: draftSession.snapshots[0]?.path,
		});
	});

	it("discards a guide session and output directory", async () => {
		const store = new GuideStore(recordingsDir);
		const session = await store.startSession(111);
		await fs.writeFile(path.join(session.outputDir, "step-001.png"), "");

		await store.discardSession({ recordingId: 111 });

		await expect(fs.stat(session.guidePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.stat(session.outputDir)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
