import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type AddGuideMarkerInput,
	type DiscardGuideSessionInput,
	type ExportGuideInput,
	type ExportGuideResult,
	type FinalizeGuideEventsInput,
	type GeneratedGuide,
	type GeneratedGuideStep,
	type GenerateGuideDraftInput,
	GUIDE_SCHEMA_VERSION,
	type GuideErrorCode,
	type GuideEvent,
	type GuideEventKind,
	type GuideEventSource,
	type GuideSession,
	type GuideSessionStatus,
	type GuideSnapshot,
	type GuideStepCandidate,
	type OcrBlock,
	type RunGuideOcrInput,
	type SaveGuideInput,
	type WriteGuideSnapshotInput,
} from "../../src/guide/contracts";
import { buildGuideEventsFromCursor, mergeGuideEvents } from "../../src/guide/eventBuilder";
import { exportGuideToHtml, exportGuideToMarkdown } from "../../src/guide/exporters";
import { buildLocalGuideDraft } from "../../src/guide/promptBuilder";
import { buildGuideStepCandidates } from "../../src/guide/targetMapper";
import type { CursorRecordingSample } from "../../src/native/contracts";
import {
	DeepSeekGuideClient,
	DeepSeekGuideClientError,
	type GuideDraftClient,
} from "./ai/deepseekGuideClient";
import type { DeepSeekGuideConfigProvider } from "./ai/deepseekSettingsStore";
import { type GuidePaths, normalizeGuideRecordingId, resolveGuidePaths } from "./guidePaths";
import { createFocusedOcrSnapshot, remapFocusedOcrBlocks } from "./ocr/focusedOcrSnapshot";
import { DefaultGuideOcrClient, type GuideOcrClient } from "./ocr/paddleOcrClient";

const VALID_SESSION_STATUSES = new Set<GuideSessionStatus>([
	"recording",
	"events-ready",
	"snapshots-ready",
	"ocr-ready",
	"draft-ready",
	"reviewed",
]);

const VALID_EVENT_KINDS = new Set<GuideEventKind>(["click", "hotkey", "manual"]);
const VALID_EVENT_SOURCES = new Set<GuideEventSource>([
	"cursor-recording",
	"guide-hotkey",
	"review-ui",
]);

export class GuideStoreError extends Error {
	constructor(
		readonly code: GuideErrorCode,
		message: string,
		readonly retryable = false,
	) {
		super(message);
		this.name = "GuideStoreError";
	}
}

export interface GuideStoreDependencies {
	ocrClient?: GuideOcrClient;
	draftClient?: GuideDraftClient;
	deepSeekConfigProvider?: DeepSeekGuideConfigProvider;
	focusOcrSnapshots?: boolean;
}

export class GuideStore {
	constructor(
		private readonly recordingsDir: string,
		private readonly dependencies: GuideStoreDependencies = {},
	) {}

	async startSession(recordingIdInput: AddGuideMarkerInput["recordingId"]): Promise<GuideSession> {
		const paths = this.requireGuidePaths(recordingIdInput);
		const now = new Date().toISOString();
		const session: GuideSession = {
			schemaVersion: GUIDE_SCHEMA_VERSION,
			recordingId: paths.recordingId,
			videoPath: "",
			guidePath: paths.guidePath,
			outputDir: paths.outputDir,
			status: "recording",
			events: [],
			snapshots: [],
			ocrBlocks: [],
			candidates: [],
			createdAt: now,
			updatedAt: now,
		};

		await this.writeSession(session);
		return session;
	}

	async readSession(recordingIdInput: AddGuideMarkerInput["recordingId"]): Promise<GuideSession> {
		const paths = this.requireGuidePaths(recordingIdInput);
		return await this.readSessionAtPath(paths.guidePath);
	}

	async addMarker(
		input: AddGuideMarkerInput,
	): Promise<{ session: GuideSession; event: GuideEvent }> {
		const recordingId = normalizeGuideRecordingId(input.recordingId);
		if (!recordingId) {
			throw new GuideStoreError("guide-invalid-input", "Guide marker is missing recordingId.");
		}
		if (input.kind !== "hotkey" && input.kind !== "manual") {
			throw new GuideStoreError("guide-invalid-input", "Guide marker kind is invalid.");
		}
		if (!Number.isFinite(input.timeMs) || input.timeMs < 0) {
			throw new GuideStoreError("guide-invalid-input", "Guide marker timeMs must be non-negative.");
		}

		const session = await this.readSession(recordingId);
		const event: GuideEvent = {
			id: `guide-event-${randomUUID()}`,
			recordingId,
			kind: input.kind,
			source: input.kind === "hotkey" ? "guide-hotkey" : "review-ui",
			timeMs: Math.max(0, input.timeMs),
			...normalizeMarkerPoint(input),
			label: normalizeOptionalString(input.label),
			screenshotOffsetMs: 500,
			createdAt: new Date().toISOString(),
		};

		const updatedSession = touchSession({
			...session,
			events: sortGuideEvents([...session.events, event]),
		});
		await this.writeSession(updatedSession);
		return { session: updatedSession, event };
	}

	async finalizeEvents(input: FinalizeGuideEventsInput): Promise<GuideSession> {
		const recordingId = normalizeGuideRecordingId(input.recordingId);
		if (!recordingId) {
			throw new GuideStoreError(
				"guide-invalid-input",
				"Guide finalization is missing recordingId.",
			);
		}
		if (typeof input.videoPath !== "string" || input.videoPath.trim().length === 0) {
			throw new GuideStoreError("guide-invalid-input", "Guide finalization is missing videoPath.");
		}

		const videoPath = path.resolve(input.videoPath);
		const currentSession = await this.readSession(recordingId);
		const nextPaths = this.requireGuidePaths(recordingId, videoPath);
		const cursorPath = await this.resolveCursorPath(videoPath, input.cursorPath);
		const cursorEvents = cursorPath
			? await this.readCursorGuideEvents(recordingId, cursorPath)
			: [];
		const manualEvents = currentSession.events.filter(
			(event) => event.source !== "cursor-recording",
		);
		const updatedSession = touchSession({
			...currentSession,
			videoPath,
			cursorPath,
			guidePath: nextPaths.guidePath,
			outputDir: nextPaths.outputDir,
			status: "events-ready",
			events: mergeGuideEvents([...cursorEvents, ...manualEvents]),
		});

		await this.writeSession(updatedSession);
		if (path.resolve(currentSession.guidePath) !== path.resolve(updatedSession.guidePath)) {
			await fs.unlink(currentSession.guidePath).catch(() => undefined);
		}

		return updatedSession;
	}

	async writeSnapshot(input: WriteGuideSnapshotInput): Promise<GuideSession> {
		const recordingId = normalizeGuideRecordingId(input.recordingId);
		if (!recordingId) {
			throw new GuideStoreError("guide-invalid-input", "Snapshot write is missing recordingId.");
		}
		if (!input.eventId || !Number.isFinite(input.timeMs) || input.timeMs < 0) {
			throw new GuideStoreError("guide-invalid-input", "Snapshot metadata is invalid.");
		}
		if (!input.pngBytes || input.pngBytes.byteLength === 0) {
			throw new GuideStoreError("guide-invalid-input", "Snapshot PNG data is empty.");
		}
		if (
			!Number.isFinite(input.width) ||
			input.width <= 0 ||
			!Number.isFinite(input.height) ||
			input.height <= 0
		) {
			throw new GuideStoreError("guide-invalid-input", "Snapshot dimensions are invalid.");
		}

		const session = await this.readSession(recordingId);
		const eventIndex = session.events.findIndex((event) => event.id === input.eventId);
		if (eventIndex === -1) {
			throw new GuideStoreError("guide-invalid-input", "Snapshot event does not exist.");
		}

		this.assertGuidePathIsAllowed(session.outputDir);
		await fs.mkdir(session.outputDir, { recursive: true });
		const fileName = `step-${String(eventIndex + 1).padStart(3, "0")}.png`;
		const snapshotPath = path.join(session.outputDir, fileName);
		this.assertGuidePathIsAllowed(snapshotPath);
		await fs.writeFile(snapshotPath, Buffer.from(new Uint8Array(input.pngBytes)));

		const snapshot: GuideSnapshot = {
			id: `snapshot-${input.eventId}`,
			eventId: input.eventId,
			timeMs: Math.max(0, input.timeMs),
			offsetMs: input.offsetMs,
			path: snapshotPath,
			width: Math.round(input.width),
			height: Math.round(input.height),
		};
		const updatedSnapshots = [
			...session.snapshots.filter((existing) => existing.eventId !== input.eventId),
			snapshot,
		].sort((left, right) => left.timeMs - right.timeMs);
		const updatedSession = touchSession({
			...session,
			status: "snapshots-ready",
			snapshots: updatedSnapshots,
			ocrBlocks: session.ocrBlocks.filter((block) => block.snapshotId !== snapshot.id),
			candidates: buildGuideStepCandidates({
				...session,
				snapshots: updatedSnapshots,
				ocrBlocks: session.ocrBlocks.filter((block) => block.snapshotId !== snapshot.id),
			}),
			generatedGuide: undefined,
		});

		await this.writeSession(updatedSession);
		return updatedSession;
	}

	async runOcr(input: RunGuideOcrInput): Promise<GuideSession> {
		const session = await this.readSession(input.recordingId);
		const requestedIds = new Set(input.snapshotIds ?? []);
		const snapshots =
			requestedIds.size > 0
				? session.snapshots.filter((snapshot) => requestedIds.has(snapshot.id))
				: session.snapshots;
		if (snapshots.length === 0) {
			throw new GuideStoreError("guide-invalid-input", "No guide snapshots are available for OCR.");
		}

		const ocrClient = this.dependencies.ocrClient ?? new DefaultGuideOcrClient();
		const shouldFocusOcrSnapshots =
			this.dependencies.focusOcrSnapshots ?? this.dependencies.ocrClient === undefined;
		const eventsById = new Map(session.events.map((event) => [event.id, event]));
		const blocks: OcrBlock[] = [];
		try {
			for (const snapshot of snapshots) {
				const focusedSnapshot = shouldFocusOcrSnapshots
					? await createFocusedOcrSnapshot({
							snapshot,
							event: eventsById.get(snapshot.eventId),
							outputDir: session.outputDir,
						})
					: { snapshot };
				const recognizedBlocks = await ocrClient.recognize(focusedSnapshot.snapshot);
				blocks.push(...remapFocusedOcrBlocks(recognizedBlocks, focusedSnapshot.transform));
			}
		} catch (error) {
			throw new GuideStoreError(
				"guide-ocr-unavailable",
				error instanceof Error ? error.message : "OCR failed.",
				true,
			);
		}

		const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
		const updatedOcrBlocks = [
			...session.ocrBlocks.filter((block) => !snapshotIds.has(block.snapshotId)),
			...blocks,
		];
		const draftSession = {
			...session,
			ocrBlocks: updatedOcrBlocks,
		};
		const updatedSession = touchSession({
			...draftSession,
			status: "ocr-ready",
			candidates: buildGuideStepCandidates(draftSession),
			generatedGuide: undefined,
		});

		await this.writeSession(updatedSession);
		return updatedSession;
	}

	async generateDraft(input: GenerateGuideDraftInput): Promise<GuideSession> {
		const session = await this.readSession(input.recordingId);
		const candidates =
			session.candidates.length > 0 ? session.candidates : buildGuideStepCandidates(session);
		if (candidates.length === 0) {
			throw new GuideStoreError(
				"guide-invalid-input",
				"No guide events are available for drafting.",
			);
		}

		let generatedGuide: GeneratedGuide;
		if (input.provider === "local") {
			generatedGuide = buildLocalGuideDraft(session, candidates, input.language);
		} else {
			const draftClient =
				this.dependencies.draftClient ??
				new DeepSeekGuideClient(this.dependencies.deepSeekConfigProvider);
			try {
				generatedGuide = await draftClient.generate({
					session,
					candidates,
					language: input.language,
				});
			} catch (error) {
				if (error instanceof DeepSeekGuideClientError) {
					throw new GuideStoreError(error.code, error.message, error.retryable);
				}
				throw new GuideStoreError(
					"guide-ai-request-failed",
					error instanceof Error ? error.message : "Guide draft generation failed.",
					true,
				);
			}
		}

		const normalizedGuide = normalizeGeneratedGuide(generatedGuide) ?? generatedGuide;
		const updatedSession = touchSession({
			...session,
			candidates,
			generatedGuide: enrichGeneratedGuide(normalizedGuide, session, candidates, input.language),
			status: "draft-ready",
		});
		await this.writeSession(updatedSession);
		return updatedSession;
	}

	async saveGuide(input: SaveGuideInput): Promise<GuideSession> {
		const session = await this.readSession(input.recordingId);
		const generatedGuide = normalizeGeneratedGuide(input.generatedGuide);
		if (!generatedGuide) {
			throw new GuideStoreError("guide-invalid-input", "Generated guide shape is invalid.");
		}

		const updatedSession = touchSession({
			...session,
			generatedGuide,
			status: "reviewed",
		});
		await this.writeSession(updatedSession);
		return updatedSession;
	}

	async exportMarkdown(input: ExportGuideInput): Promise<ExportGuideResult> {
		const session = await this.readSession(input.recordingId);
		return await this.writeGuideExport(session, "guide.md", () => exportGuideToMarkdown(session));
	}

	async exportHtml(input: ExportGuideInput): Promise<ExportGuideResult> {
		const session = await this.readSession(input.recordingId);
		return await this.writeGuideExport(session, "guide.html", () => exportGuideToHtml(session));
	}

	async discardSession(input: DiscardGuideSessionInput): Promise<void> {
		const paths = this.requireGuidePaths(input.recordingId);
		const session = await this.readSession(input.recordingId).catch(() => null);
		const guidePath = session?.guidePath ?? paths.guidePath;
		const outputDir = session?.outputDir ?? paths.outputDir;
		this.assertGuidePathIsAllowed(guidePath);
		this.assertGuidePathIsAllowed(outputDir);
		await fs.unlink(guidePath).catch(() => undefined);
		await fs.rm(outputDir, { recursive: true, force: true });
	}

	private async writeGuideExport(
		session: GuideSession,
		fileName: string,
		renderContent: () => string,
	): Promise<ExportGuideResult> {
		if (!session.generatedGuide) {
			throw new GuideStoreError("guide-invalid-input", "Generate a guide draft before exporting.");
		}
		const exportPath = path.join(session.outputDir, fileName);
		this.assertGuidePathIsAllowed(exportPath);
		try {
			await fs.mkdir(session.outputDir, { recursive: true });
			await fs.writeFile(exportPath, renderContent(), "utf-8");
		} catch (error) {
			throw new GuideStoreError(
				"guide-export-failed",
				error instanceof Error ? error.message : "Guide export failed.",
				true,
			);
		}
		return { path: exportPath, session };
	}

	async writeSession(session: GuideSession): Promise<void> {
		const normalized = normalizeGuideSession(session);
		if (!normalized) {
			throw new GuideStoreError("guide-invalid-schema", "Guide session schema is invalid.");
		}
		this.assertGuidePathIsAllowed(normalized.guidePath);
		this.assertGuidePathIsAllowed(normalized.outputDir);
		await fs.mkdir(path.dirname(normalized.guidePath), { recursive: true });
		await fs.mkdir(normalized.outputDir, { recursive: true });
		await atomicWriteJson(normalized.guidePath, normalized);
	}

	private async readSessionAtPath(guidePath: string): Promise<GuideSession> {
		this.assertGuidePathIsAllowed(guidePath);
		try {
			const content = await fs.readFile(guidePath, "utf-8");
			const session = normalizeGuideSession(JSON.parse(content));
			if (!session) {
				throw new GuideStoreError("guide-invalid-schema", "Guide session schema is invalid.");
			}
			return session;
		} catch (error) {
			if (error instanceof GuideStoreError) {
				throw error;
			}
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				throw new GuideStoreError("guide-session-not-found", "Guide session was not found.");
			}
			throw error;
		}
	}

	private requireGuidePaths(
		recordingIdInput: AddGuideMarkerInput["recordingId"],
		videoPath?: string | null,
	): GuidePaths {
		const paths = resolveGuidePaths({
			recordingsDir: this.recordingsDir,
			recordingId: recordingIdInput,
			videoPath,
		});
		if (!paths) {
			throw new GuideStoreError("guide-invalid-input", "Guide recordingId is invalid.");
		}
		this.assertGuidePathIsAllowed(paths.guidePath);
		this.assertGuidePathIsAllowed(paths.outputDir);
		return paths;
	}

	private assertGuidePathIsAllowed(targetPath: string): void {
		if (this.isPathAllowed(targetPath)) {
			return;
		}

		throw new GuideStoreError(
			"guide-invalid-input",
			"Guide artifacts must be stored inside the recordings directory.",
		);
	}

	private async resolveCursorPath(
		videoPath: string,
		explicitCursorPath?: string,
	): Promise<string | undefined> {
		const candidates = [
			normalizeOptionalString(explicitCursorPath),
			`${videoPath}.cursor.json`,
		].filter((candidate): candidate is string => Boolean(candidate));

		for (const candidate of candidates) {
			const resolvedCandidate = path.resolve(candidate);
			if (!this.isPathAllowed(resolvedCandidate)) {
				continue;
			}

			try {
				await fs.access(resolvedCandidate);
				return resolvedCandidate;
			} catch {
				// Cursor telemetry is optional for guide sessions.
			}
		}

		return undefined;
	}

	private async readCursorGuideEvents(
		recordingId: string,
		cursorPath: string,
	): Promise<GuideEvent[]> {
		try {
			const content = await fs.readFile(cursorPath, "utf-8");
			const parsed = JSON.parse(content) as unknown;
			const rawSamples =
				isRecord(parsed) && Array.isArray(parsed.samples) ? parsed.samples : parsed;
			const samples = Array.isArray(rawSamples)
				? rawSamples
						.map(normalizeCursorSampleForGuide)
						.filter((sample): sample is CursorRecordingSample => sample !== null)
				: [];
			return buildGuideEventsFromCursor({ recordingId, samples });
		} catch (error) {
			console.warn("Failed to read cursor telemetry for guide events:", error);
			return [];
		}
	}

	private isPathAllowed(targetPath: string): boolean {
		const resolvedTarget = path.resolve(targetPath);
		const resolvedRecordingsDir = path.resolve(this.recordingsDir);
		const relative = path.relative(resolvedRecordingsDir, resolvedTarget);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
	}
}

function touchSession(session: GuideSession): GuideSession {
	return {
		...session,
		updatedAt: new Date().toISOString(),
	};
}

function sortGuideEvents(events: GuideEvent[]): GuideEvent[] {
	return [...events].sort((left, right) => left.timeMs - right.timeMs);
}

function normalizeCursorSampleForGuide(input: unknown): CursorRecordingSample | null {
	if (!isRecord(input)) {
		return null;
	}

	const interactionType =
		input.interactionType === "click" ||
		input.interactionType === "mouseup" ||
		input.interactionType === "move"
			? input.interactionType
			: "move";
	const timeMs = normalizeNonNegativeNumber(input.timeMs);
	const cx = normalizeOptionalNumber(input.cx);
	const cy = normalizeOptionalNumber(input.cy);
	if (timeMs === null || cx === undefined || cy === undefined) {
		return null;
	}

	return {
		timeMs,
		cx,
		cy,
		interactionType,
	};
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
	await fs.rename(tempPath, filePath);
}

function normalizeGuideSession(input: unknown): GuideSession | null {
	if (!isRecord(input) || input.schemaVersion !== GUIDE_SCHEMA_VERSION) {
		return null;
	}

	const recordingId = normalizeString(input.recordingId);
	const videoPath = normalizeString(input.videoPath);
	const guidePath = normalizeString(input.guidePath);
	const outputDir = normalizeString(input.outputDir);
	const status = normalizeSessionStatus(input.status);
	const createdAt = normalizeString(input.createdAt);
	const updatedAt = normalizeString(input.updatedAt);
	if (
		!recordingId ||
		videoPath === null ||
		!guidePath ||
		!outputDir ||
		!status ||
		!createdAt ||
		!updatedAt
	) {
		return null;
	}

	const generatedGuide =
		input.generatedGuide === undefined ? undefined : normalizeGeneratedGuide(input.generatedGuide);
	if (generatedGuide === null) {
		return null;
	}

	return {
		schemaVersion: GUIDE_SCHEMA_VERSION,
		recordingId,
		videoPath,
		cursorPath: normalizeOptionalString(input.cursorPath),
		guidePath,
		outputDir,
		status,
		events: normalizeArray(input.events, normalizeGuideEvent),
		snapshots: normalizeArray(input.snapshots, normalizeGuideSnapshot),
		ocrBlocks: normalizeArray(input.ocrBlocks, normalizeOcrBlock),
		candidates: normalizeArray(input.candidates, normalizeGuideStepCandidate),
		generatedGuide,
		createdAt,
		updatedAt,
	};
}

function normalizeGuideEvent(input: unknown): GuideEvent | null {
	if (!isRecord(input)) {
		return null;
	}
	const id = normalizeString(input.id);
	const recordingId = normalizeString(input.recordingId);
	const kind = VALID_EVENT_KINDS.has(input.kind as GuideEventKind)
		? (input.kind as GuideEventKind)
		: null;
	const source = VALID_EVENT_SOURCES.has(input.source as GuideEventSource)
		? (input.source as GuideEventSource)
		: null;
	const timeMs = normalizeNonNegativeNumber(input.timeMs);
	const createdAt = normalizeString(input.createdAt);
	if (!id || !recordingId || !kind || !source || timeMs === null || !createdAt) {
		return null;
	}

	return {
		id,
		recordingId,
		kind,
		source,
		timeMs,
		x: normalizeOptionalNumber(input.x),
		y: normalizeOptionalNumber(input.y),
		normalizedX: normalizeOptionalNumber(input.normalizedX),
		normalizedY: normalizeOptionalNumber(input.normalizedY),
		button:
			input.button === "left" ||
			input.button === "right" ||
			input.button === "middle" ||
			input.button === "unknown"
				? input.button
				: undefined,
		label: normalizeOptionalString(input.label),
		screenshotOffsetMs: normalizeOptionalNumber(input.screenshotOffsetMs),
		createdAt,
	};
}

function normalizeGuideSnapshot(input: unknown): GuideSnapshot | null {
	if (!isRecord(input)) {
		return null;
	}
	const id = normalizeString(input.id);
	const eventId = normalizeString(input.eventId);
	const pathValue = normalizeString(input.path);
	const timeMs = normalizeNonNegativeNumber(input.timeMs);
	const offsetMs = normalizeOptionalNumber(input.offsetMs);
	const width = normalizePositiveInteger(input.width);
	const height = normalizePositiveInteger(input.height);
	if (
		!id ||
		!eventId ||
		!pathValue ||
		timeMs === null ||
		offsetMs === undefined ||
		width === null ||
		height === null
	) {
		return null;
	}
	return { id, eventId, timeMs, offsetMs, path: pathValue, width, height };
}

function normalizeOcrBlock(input: unknown): OcrBlock | null {
	if (!isRecord(input) || !isRecord(input.box)) {
		return null;
	}
	const id = normalizeString(input.id);
	const snapshotId = normalizeString(input.snapshotId);
	const text = normalizeString(input.text);
	const confidence = normalizeOptionalNumber(input.confidence);
	const x = normalizeOptionalNumber(input.box.x);
	const y = normalizeOptionalNumber(input.box.y);
	const width = normalizeOptionalNumber(input.box.width);
	const height = normalizeOptionalNumber(input.box.height);
	if (
		!id ||
		!snapshotId ||
		text === null ||
		confidence === undefined ||
		x === undefined ||
		y === undefined ||
		width === undefined ||
		height === undefined
	) {
		return null;
	}
	return { id, snapshotId, text, confidence, box: { x, y, width, height } };
}

function normalizeGuideStepCandidate(input: unknown): GuideStepCandidate | null {
	if (!isRecord(input)) {
		return null;
	}
	const id = normalizeString(input.id);
	const eventId = normalizeString(input.eventId);
	const timeMs = normalizeNonNegativeNumber(input.timeMs);
	const confidence = normalizeOptionalNumber(input.confidence);
	const nearbyText = Array.isArray(input.nearbyText)
		? input.nearbyText.map(normalizeString).filter((text): text is string => text !== null)
		: [];
	if (!id || !eventId || timeMs === null || confidence === undefined) {
		return null;
	}
	return {
		id,
		eventId,
		snapshotId: normalizeOptionalString(input.snapshotId),
		timeMs,
		action:
			input.action === "click" ||
			input.action === "choose" ||
			input.action === "type" ||
			input.action === "wait" ||
			input.action === "manual"
				? input.action
				: "manual",
		targetText: normalizeOptionalString(input.targetText),
		targetRole:
			input.targetRole === "button" ||
			input.targetRole === "menu" ||
			input.targetRole === "tab" ||
			input.targetRole === "field" ||
			input.targetRole === "link" ||
			input.targetRole === "unknown"
				? input.targetRole
				: undefined,
		position: normalizeGuideCandidatePosition(input.position),
		nearbyText,
		confidence,
	};
}

function normalizeGuideCandidatePosition(
	input: unknown,
): GuideStepCandidate["position"] | undefined {
	if (!isRecord(input)) {
		return undefined;
	}
	const normalizedX = normalizeOptionalNormalizedNumber(input.normalizedX);
	const normalizedY = normalizeOptionalNormalizedNumber(input.normalizedY);
	const xPercent = normalizeOptionalNumber(input.xPercent);
	const yPercent = normalizeOptionalNumber(input.yPercent);
	const description = normalizeOptionalString(input.description);
	if (
		normalizedX === undefined ||
		normalizedY === undefined ||
		xPercent === undefined ||
		yPercent === undefined ||
		!description
	) {
		return undefined;
	}
	return {
		normalizedX,
		normalizedY,
		xPercent,
		yPercent,
		description,
	};
}

function normalizeGeneratedGuide(input: unknown): GeneratedGuide | null {
	if (!isRecord(input)) {
		return null;
	}
	const title = normalizeString(input.title);
	if (!title || !Array.isArray(input.steps)) {
		return null;
	}
	const steps = input.steps
		.map((step): GeneratedGuideStep | null => {
			if (!isRecord(step)) {
				return null;
			}
			const id = normalizeString(step.id);
			const order = normalizePositiveInteger(step.order);
			const stepTitle = normalizeString(step.title);
			const instruction = normalizeString(step.instruction);
			if (!id || order === null || !stepTitle || !instruction) {
				return null;
			}
			return {
				id,
				order,
				title: stepTitle,
				instruction,
				screenshotPath: normalizeOptionalString(step.screenshotPath),
				sourceCandidateId: normalizeOptionalString(step.sourceCandidateId),
			};
		})
		.filter((step): step is GeneratedGuide["steps"][number] => step !== null);
	return {
		title,
		summary: normalizeOptionalString(input.summary),
		steps,
	};
}

function enrichGeneratedGuide(
	guide: GeneratedGuide,
	session: GuideSession,
	candidates: GuideStepCandidate[],
	language: GenerateGuideDraftInput["language"],
): GeneratedGuide {
	const sortedCandidates = [...candidates].sort((left, right) => left.timeMs - right.timeMs);
	const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const snapshotsById = new Map(session.snapshots.map((snapshot) => [snapshot.id, snapshot]));
	const snapshotsByEventId = new Map(
		session.snapshots.map((snapshot) => [snapshot.eventId, snapshot]),
	);

	return {
		...guide,
		steps: guide.steps.map((step, index) => {
			const candidate =
				(step.sourceCandidateId ? candidatesById.get(step.sourceCandidateId) : undefined) ??
				sortedCandidates[index];
			const snapshot = candidate
				? ((candidate.snapshotId ? snapshotsById.get(candidate.snapshotId) : undefined) ??
					snapshotsByEventId.get(candidate.eventId))
				: undefined;
			const repairedStep = repairGenericMarkerStep(step, candidate, language);
			return {
				...repairedStep,
				sourceCandidateId: candidate?.id ?? repairedStep.sourceCandidateId,
				screenshotPath: repairedStep.screenshotPath ?? snapshot?.path,
			};
		}),
	};
}

function repairGenericMarkerStep(
	step: GeneratedGuideStep,
	candidate: GuideStepCandidate | undefined,
	language: GenerateGuideDraftInput["language"],
): GeneratedGuideStep {
	if (
		!candidate ||
		(!containsGenericMarkerText(step.title) && !containsGenericMarkerText(step.instruction))
	) {
		return step;
	}

	return {
		...step,
		title: buildRepairedStepTitle(candidate, step.order, language),
		instruction: buildRepairedStepInstruction(candidate, language),
	};
}

function containsGenericMarkerText(value: string): boolean {
	return /\b(?:ctrl|control)(?:\s*\+\s*f12)?\s+marker\b/i.test(value);
}

function buildRepairedStepTitle(
	candidate: GuideStepCandidate,
	order: number,
	language: GenerateGuideDraftInput["language"],
): string {
	if (candidate.targetText) {
		return language === "vi"
			? `Bước ${order}: ${candidate.targetText}`
			: `Step ${order}: ${candidate.targetText}`;
	}
	if (candidate.position) {
		return language === "vi"
			? `Bước ${order}: Vị trí x ${candidate.position.xPercent}%, y ${candidate.position.yPercent}%`
			: `Step ${order}: Position x ${candidate.position.xPercent}%, y ${candidate.position.yPercent}%`;
	}
	return stepTitleFallback(order, language);
}

function buildRepairedStepInstruction(
	candidate: GuideStepCandidate,
	language: GenerateGuideDraftInput["language"],
): string {
	if (candidate.targetText) {
		return language === "vi"
			? `Nhấn vào "${candidate.targetText}".`
			: `Click "${candidate.targetText}".`;
	}
	if (candidate.position) {
		return language === "vi"
			? `Nhấn tại vùng ${candidate.position.description} (x ${candidate.position.xPercent}%, y ${candidate.position.yPercent}%).`
			: `Click the ${candidate.position.description} area (x ${candidate.position.xPercent}%, y ${candidate.position.yPercent}%).`;
	}
	return language === "vi" ? "Thực hiện thao tác tại mốc đã ghi." : "Perform the recorded action.";
}

function stepTitleFallback(order: number, language: GenerateGuideDraftInput["language"]): string {
	return language === "vi" ? `Bước ${order}` : `Step ${order}`;
}

function normalizeArray<T>(input: unknown, normalize: (value: unknown) => T | null): T[] {
	return Array.isArray(input)
		? input.map((value) => normalize(value)).filter((value): value is T => value !== null)
		: [];
}

function normalizeSessionStatus(value: unknown): GuideSessionStatus | null {
	return VALID_SESSION_STATUSES.has(value as GuideSessionStatus)
		? (value as GuideSessionStatus)
		: null;
}

function normalizeString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
	const text = normalizeString(value);
	return text === null || text.length === 0 ? undefined : text;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeMarkerPoint(
	input: AddGuideMarkerInput,
): Pick<GuideEvent, "x" | "y" | "normalizedX" | "normalizedY"> {
	const normalizedX = normalizeOptionalNormalizedNumber(input.normalizedX ?? input.x);
	const normalizedY = normalizeOptionalNormalizedNumber(input.normalizedY ?? input.y);
	if (normalizedX === undefined || normalizedY === undefined) {
		return {};
	}

	return {
		x: normalizedX,
		y: normalizedY,
		normalizedX,
		normalizedY,
	};
}

function normalizeOptionalNormalizedNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}

	return Math.min(1, Math.max(0, value));
}

function normalizePositiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
