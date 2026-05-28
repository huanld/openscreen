export const GUIDE_SCHEMA_VERSION = 1;

export type GuideRecordingIdInput = string | number;
export type GuideEventKind = "click" | "hotkey" | "manual";
export type GuideEventSource = "cursor-recording" | "guide-hotkey" | "review-ui";
export type GuideEventButton = "left" | "right" | "middle" | "unknown";
export type GuideAction = "click" | "choose" | "type" | "wait" | "manual";
export type GuideTargetRole = "button" | "menu" | "tab" | "field" | "link" | "unknown";
export type GuideLanguage = "vi" | "en";
export type GuideAiProvider = "deepseek" | "local";
export type GuideSecretStorage = "environment" | "none";

export type GuideSessionStatus =
	| "recording"
	| "events-ready"
	| "snapshots-ready"
	| "ocr-ready"
	| "draft-ready"
	| "reviewed";

export type GuideErrorCode =
	| "guide-session-not-found"
	| "guide-invalid-input"
	| "guide-invalid-schema"
	| "guide-video-load-failed"
	| "guide-snapshot-failed"
	| "guide-ocr-unavailable"
	| "guide-ocr-failed"
	| "guide-ai-key-missing"
	| "guide-ai-request-failed"
	| "guide-ai-invalid-output"
	| "guide-export-failed"
	| "guide-internal-error";

export interface GuideEvent {
	id: string;
	recordingId: string;
	kind: GuideEventKind;
	source: GuideEventSource;
	timeMs: number;
	x?: number;
	y?: number;
	normalizedX?: number;
	normalizedY?: number;
	button?: GuideEventButton;
	label?: string;
	screenshotOffsetMs?: number;
	createdAt: string;
}

export interface GuideSnapshot {
	id: string;
	eventId: string;
	timeMs: number;
	offsetMs: number;
	path: string;
	width: number;
	height: number;
}

export interface OcrBlock {
	id: string;
	snapshotId: string;
	text: string;
	confidence: number;
	box: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

export interface GuideStepCandidate {
	id: string;
	eventId: string;
	snapshotId?: string;
	timeMs: number;
	action: GuideAction;
	targetText?: string;
	targetRole?: GuideTargetRole;
	nearbyText: string[];
	confidence: number;
}

export interface GeneratedGuideStep {
	id: string;
	order: number;
	title: string;
	instruction: string;
	screenshotPath?: string;
	sourceCandidateId?: string;
}

export interface GeneratedGuide {
	title: string;
	summary?: string;
	steps: GeneratedGuideStep[];
}

export interface GuideSession {
	schemaVersion: typeof GUIDE_SCHEMA_VERSION;
	recordingId: string;
	videoPath: string;
	cursorPath?: string;
	guidePath: string;
	outputDir: string;
	status: GuideSessionStatus;
	events: GuideEvent[];
	snapshots: GuideSnapshot[];
	ocrBlocks: OcrBlock[];
	candidates: GuideStepCandidate[];
	generatedGuide?: GeneratedGuide;
	createdAt: string;
	updatedAt: string;
}

export interface CaptureGuidePointerMarkerResult {
	captured: boolean;
	session?: GuideSession;
	event?: GuideEvent;
}

export interface AddGuideMarkerInput {
	recordingId: GuideRecordingIdInput;
	timeMs: number;
	kind: "hotkey" | "manual";
	label?: string;
	x?: number;
	y?: number;
	normalizedX?: number;
	normalizedY?: number;
}

export interface FinalizeGuideEventsInput {
	recordingId: GuideRecordingIdInput;
	videoPath: string;
	cursorPath?: string;
}

export interface WriteGuideSnapshotInput {
	recordingId: GuideRecordingIdInput;
	eventId: string;
	timeMs: number;
	offsetMs: number;
	pngBytes: ArrayBuffer;
	width: number;
	height: number;
}

export interface RunGuideOcrInput {
	recordingId: GuideRecordingIdInput;
	snapshotIds?: string[];
}

export interface GenerateGuideDraftInput {
	recordingId: GuideRecordingIdInput;
	language: GuideLanguage;
	provider: GuideAiProvider;
}

export interface GuideAiSettings {
	deepseek: {
		hasApiKey: boolean;
		apiKeyEnvName: string;
		baseUrl: string;
		model: string;
		storage: GuideSecretStorage;
		encryptionAvailable: boolean;
		updatedAt?: string;
	};
}

export interface SaveGuideAiSettingsInput {
	deepseekApiKeyEnvName?: string;
	clearDeepseekApiKeyEnvName?: boolean;
	baseUrl?: string;
	model?: string;
}

export interface SaveGuideInput {
	recordingId: GuideRecordingIdInput;
	generatedGuide: GeneratedGuide;
}

export interface DiscardGuideSessionInput {
	recordingId: GuideRecordingIdInput;
}

export interface ExportGuideInput {
	recordingId: GuideRecordingIdInput;
}

export interface ExportGuideResult {
	path: string;
	session: GuideSession;
}

export interface GuideIpcSuccess<TData> {
	success: true;
	data: TData;
	message?: string;
}

export interface GuideIpcFailure {
	success: false;
	code: GuideErrorCode;
	error: string;
	retryable?: boolean;
}

export type GuideIpcResult<TData> = GuideIpcSuccess<TData> | GuideIpcFailure;
