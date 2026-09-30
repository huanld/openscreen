import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
	AddGuideMarkerInput,
	CaptureGuidePointerMarkerResult,
	DiscardGuideSessionInput,
	ExportGuideInput,
	FinalizeGuideEventsInput,
	GenerateGuideDraftInput,
	GuideMarkerCapturedPayload,
	RunGuideOcrInput,
	SaveGuideAiSettingsInput,
	SaveGuideInput,
	WriteGuideSnapshotInput,
} from "../src/guide/contracts";
import type { McpControlRequest, McpControlResult } from "../src/lib/mcpControl";
import type { NativeMacRecordingRequest } from "../src/lib/nativeMacRecording";
import type {
	NativeWindowsRecordingEndedEvent,
	NativeWindowsRecordingRequest,
} from "../src/lib/nativeWindowsRecording";
import type { RecordingSession, StoreRecordedSessionInput } from "../src/lib/recordingSession";
import { NATIVE_BRIDGE_CHANNEL, type NativeBridgeRequest } from "../src/native/contracts";

// Asset base URL is passed from the main process via webPreferences.additionalArguments
// (see windows.ts). Sandboxed preloads cannot import node:path / node:url, so we
// can't compute it here.
const ASSET_BASE_URL_ARG_PREFIX = "--asset-base-url=";
const assetBaseUrlArg = process.argv.find((arg) => arg.startsWith(ASSET_BASE_URL_ARG_PREFIX));
const assetBaseUrl = assetBaseUrlArg ? assetBaseUrlArg.slice(ASSET_BASE_URL_ARG_PREFIX.length) : "";

let pendingScreenshotRegionShortcuts = 0;
const screenshotRegionShortcutListeners = new Set<() => void>();
ipcRenderer.on("screenshot:capture-region-shortcut", () => {
	if (screenshotRegionShortcutListeners.size === 0) {
		pendingScreenshotRegionShortcuts = 1;
		return;
	}
	for (const listener of screenshotRegionShortcutListeners) listener();
});

let hasScreenshotRegionSelectionStarted = false;
const screenshotRegionSelectionStartListeners = new Set<() => void>();
ipcRenderer.on("screenshot:region-selection-start", () => {
	hasScreenshotRegionSelectionStarted = true;
	if (screenshotRegionSelectionStartListeners.size === 0) {
		return;
	}
	for (const listener of screenshotRegionSelectionStartListeners) listener();
});

contextBridge.exposeInMainWorld("electronAPI", {
	assetBaseUrl,
	updates: {
		getStatus: () => {
			return ipcRenderer.invoke("updates:get-status");
		},
		check: () => {
			return ipcRenderer.invoke("updates:check");
		},
		install: () => {
			return ipcRenderer.invoke("updates:install");
		},
		onStatus: (callback: (status: import("../src/lib/updateStatus").UpdateStatus) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				status: import("../src/lib/updateStatus").UpdateStatus,
			) => {
				callback(status);
			};
			ipcRenderer.on("updates:status", listener);
			return () => ipcRenderer.removeListener("updates:status", listener);
		},
	},
	invokeNativeBridge: <TData>(request: NativeBridgeRequest) => {
		return ipcRenderer.invoke(NATIVE_BRIDGE_CHANNEL, request) as Promise<TData>;
	},
	guide: {
		startSession: (recordingId: string | number) => {
			return ipcRenderer.invoke("guide:start-session", recordingId);
		},
		readSession: (recordingId: string | number) => {
			return ipcRenderer.invoke("guide:read-session", recordingId);
		},
		addMarker: (input: AddGuideMarkerInput) => {
			return ipcRenderer.invoke("guide:add-marker", input);
		},
		capturePointerMarker: () => {
			return ipcRenderer.invoke("guide:capture-pointer-marker") as Promise<
				import("../src/guide/contracts").GuideIpcResult<CaptureGuidePointerMarkerResult>
			>;
		},
		onMarkerCaptured: (callback: (payload: GuideMarkerCapturedPayload) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: GuideMarkerCapturedPayload) => {
				callback(payload);
			};
			ipcRenderer.on("guide:marker-captured", listener);
			return () => ipcRenderer.removeListener("guide:marker-captured", listener);
		},
		finalizeEvents: (input: FinalizeGuideEventsInput) => {
			return ipcRenderer.invoke("guide:finalize-events", input);
		},
		writeSnapshot: (input: WriteGuideSnapshotInput) => {
			return ipcRenderer.invoke("guide:write-snapshot", input);
		},
		runOcr: (input: RunGuideOcrInput) => {
			return ipcRenderer.invoke("guide:run-ocr", input);
		},
		generateDraft: (input: GenerateGuideDraftInput) => {
			return ipcRenderer.invoke("guide:generate-draft", input);
		},
		getAiSettings: () => {
			return ipcRenderer.invoke("guide:get-ai-settings");
		},
		saveAiSettings: (input: SaveGuideAiSettingsInput) => {
			return ipcRenderer.invoke("guide:save-ai-settings", input);
		},
		saveGuide: (input: SaveGuideInput) => {
			return ipcRenderer.invoke("guide:save-guide", input);
		},
		exportMarkdown: (input: ExportGuideInput) => {
			return ipcRenderer.invoke("guide:export-markdown", input);
		},
		exportHtml: (input: ExportGuideInput) => {
			return ipcRenderer.invoke("guide:export-html", input);
		},
		discardSession: (input: DiscardGuideSessionInput) => {
			return ipcRenderer.invoke("guide:discard-session", input);
		},
	},
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	setHudOverlayIgnoreMouseEvents: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-ignore-mouse-events", ignore);
	},
	moveHudOverlayBy: (deltaX: number, deltaY: number) => {
		ipcRenderer.send("hud-overlay-move-by", deltaX, deltaY);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	switchToHud: () => {
		return ipcRenderer.invoke("switch-to-hud");
	},
	startNewRecording: () => {
		return ipcRenderer.invoke("start-new-recording");
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	requestCameraAccess: () => {
		return ipcRenderer.invoke("request-camera-access");
	},
	requestScreenAccess: () => {
		return ipcRenderer.invoke("request-screen-access");
	},
	requestNativeMacCursorAccess: () => {
		return ipcRenderer.invoke("request-native-mac-cursor-access");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeRecordedSession: (payload: StoreRecordedSessionInput) => {
		return ipcRenderer.invoke("store-recorded-session", payload);
	},
	openRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("open-recording-stream", fileName);
	},
	appendRecordingChunk: (fileName: string, chunk: ArrayBuffer) => {
		return ipcRenderer.invoke("append-recording-chunk", fileName, chunk);
	},
	closeRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("close-recording-stream", fileName);
	},

	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	setRecordingState: (
		recording: boolean,
		recordingId?: number,
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode,
	) => {
		return ipcRenderer.invoke("set-recording-state", recording, recordingId, cursorCaptureMode);
	},
	isNativeWindowsCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-windows-capture-available");
	},
	isNativeMacCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-mac-capture-available");
	},
	startNativeWindowsRecording: (request: NativeWindowsRecordingRequest) => {
		return ipcRenderer.invoke("start-native-windows-recording", request);
	},
	stopNativeWindowsRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-windows-recording", discard);
	},
	getNativeWindowsRecordingState: () => {
		return ipcRenderer.invoke("get-native-windows-recording-state");
	},
	onNativeWindowsRecordingEnded: (callback: (event: NativeWindowsRecordingEndedEvent) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: NativeWindowsRecordingEndedEvent,
		) => callback(payload);
		ipcRenderer.on("native-windows-recording-ended", listener);
		return () => ipcRenderer.removeListener("native-windows-recording-ended", listener);
	},
	pauseNativeWindowsRecording: () => {
		return ipcRenderer.invoke("pause-native-windows-recording");
	},
	resumeNativeWindowsRecording: () => {
		return ipcRenderer.invoke("resume-native-windows-recording");
	},
	startNativeMacRecording: (request: NativeMacRecordingRequest) => {
		return ipcRenderer.invoke("start-native-mac-recording", request);
	},
	pauseNativeMacRecording: () => {
		return ipcRenderer.invoke("pause-native-mac-recording");
	},
	resumeNativeMacRecording: () => {
		return ipcRenderer.invoke("resume-native-mac-recording");
	},
	stopNativeMacRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-mac-recording", discard);
	},
	attachNativeMacWebcamRecording: (payload: {
		screenVideoPath: string;
		recordingId: number;
		webcam: { fileName: string; videoData: ArrayBuffer };
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode;
	}) => {
		return ipcRenderer.invoke("attach-native-mac-webcam-recording", payload);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	discardCursorTelemetry: (recordingId: number) => {
		return ipcRenderer.invoke("discard-cursor-telemetry", recordingId);
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	pickExportSavePath: (fileName: string, exportFolder?: string) => {
		return ipcRenderer.invoke("pick-export-save-path", fileName, exportFolder);
	},
	writeExportToPath: (videoData: ArrayBuffer, filePath: string) => {
		return ipcRenderer.invoke("write-export-to-path", videoData, filePath);
	},
	openVideoFilePicker: () => {
		return ipcRenderer.invoke("open-video-file-picker");
	},
	openAudioFilePicker: () => {
		return ipcRenderer.invoke("open-audio-file-picker");
	},
	setCurrentVideoPath: (path: string) => {
		return ipcRenderer.invoke("set-current-video-path", path);
	},
	setCurrentRecordingSession: (session: RecordingSession | null) => {
		return ipcRenderer.invoke("set-current-recording-session", session);
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	readBinaryFile: (filePath: string) => {
		return ipcRenderer.invoke("read-binary-file", filePath);
	},
	preparePreviewAudioTrack: (filePath: string) => {
		return ipcRenderer.invoke("prepare-preview-audio-track", filePath);
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
		return ipcRenderer.invoke("save-project-file", projectData, suggestedName, existingProjectPath);
	},
	getPathForFile: (file: File) => webUtils.getPathForFile(file),
	loadProjectFile: (projectFolder?: string) => {
		return ipcRenderer.invoke("load-project-file", projectFolder);
	},
	loadProjectFileFromPath: (path: string) =>
		ipcRenderer.invoke(NATIVE_BRIDGE_CHANNEL, {
			domain: "project",
			action: "loadProjectFileFromPath",
			payload: { path },
		}),
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	onScreenshotRegionShortcut: (callback: () => void) => {
		screenshotRegionShortcutListeners.add(callback);
		if (pendingScreenshotRegionShortcuts > 0) {
			pendingScreenshotRegionShortcuts = 0;
			queueMicrotask(callback);
		}
		return () => screenshotRegionShortcutListeners.delete(callback);
	},
	onScreenshotRegionSelectionStart: (callback: () => void) => {
		screenshotRegionSelectionStartListeners.add(callback);
		if (hasScreenshotRegionSelectionStarted) {
			// Keep the start latched for React StrictMode/HMR re-subscriptions. Each
			// region renderer is single-use, so replaying only refreshes active data.
			queueMicrotask(callback);
		}
		return () => screenshotRegionSelectionStartListeners.delete(callback);
	},
	onScreenshotRegionShortcutBlocked: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("screenshot:capture-region-shortcut-blocked", listener);
		return () => ipcRenderer.removeListener("screenshot:capture-region-shortcut-blocked", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	setLocale: (locale: string) => {
		return ipcRenderer.invoke("set-locale", locale);
	},
	saveDiagnostic: (payload: {
		error: string;
		stack?: string;
		projectState: unknown;
		logs: string[];
	}) => {
		return ipcRenderer.invoke("save-diagnostic", payload);
	},
	setMicrophoneExpanded: (expanded: boolean) => {
		ipcRenderer.send("hud:setMicrophoneExpanded", expanded);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	cancelPendingExit: () => {
		ipcRenderer.send("cancel-pending-exit");
	},
	showCountdownOverlay: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-show", value, runId);
	},
	setCountdownOverlayValue: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-set-value", value, runId);
	},
	hideCountdownOverlay: (runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-hide", runId);
	},
	onMcpControlRequest: (
		callback: (request: McpControlRequest) => Promise<McpControlResult> | McpControlResult,
	) => {
		const listener = async (_event: unknown, request: McpControlRequest) => {
			try {
				const result = await callback(request);
				ipcRenderer.send("mcp-control-response", { id: request.id, result });
			} catch (error) {
				ipcRenderer.send("mcp-control-response", {
					id: request.id,
					result: {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
		};
		ipcRenderer.on("mcp-control-request", listener);
		return () => ipcRenderer.removeListener("mcp-control-request", listener);
	},
	onCountdownOverlayValue: (callback: (value: number | null) => void) => {
		const listener = (_event: unknown, value: number | null) => callback(value);
		ipcRenderer.on("countdown-overlay-value", listener);
		return () => ipcRenderer.removeListener("countdown-overlay-value", listener);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => {
		const listener = async () => {
			try {
				const shouldClose = await callback();
				ipcRenderer.send("save-before-close-done", shouldClose);
			} catch {
				ipcRenderer.send("save-before-close-done", false);
			}
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	onRequestCloseConfirm: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("request-close-confirm", listener);
		return () => ipcRenderer.removeListener("request-close-confirm", listener);
	},
	onCancelCloseConfirm: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("cancel-close-confirm", listener);
		return () => ipcRenderer.removeListener("cancel-close-confirm", listener);
	},
	onRequestCloseState: (callback: () => boolean) => {
		const listener = () => {
			let hasChanges = true;
			try {
				hasChanges = callback();
			} catch {
				// Failing closed is safer than losing unsaved edits.
			}
			ipcRenderer.send("close-state-response", hasChanges);
		};
		ipcRenderer.on("request-close-state", listener);
		return () => ipcRenderer.removeListener("request-close-state", listener);
	},
	sendCloseConfirmResponse: (choice: "save" | "discard" | "cancel") => {
		ipcRenderer.send("close-confirm-response", choice);
	},
});
