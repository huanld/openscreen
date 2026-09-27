import type { IpcMain } from "electron";
import type {
	AddGuideMarkerInput,
	DiscardGuideSessionInput,
	ExportGuideInput,
	ExportGuideResult,
	FinalizeGuideEventsInput,
	GenerateGuideDraftInput,
	GuideAiSettings,
	GuideEvent,
	GuideIpcResult,
	GuideSession,
	RunGuideOcrInput,
	SaveGuideAiSettingsInput,
	SaveGuideInput,
	WriteGuideSnapshotInput,
} from "../../src/guide/contracts";
import type { DeepSeekSettingsStore } from "./ai/deepseekSettingsStore";
import { GuideStore, GuideStoreError } from "./guideStore";

export interface GuideIpcLifecycle {
	onSessionStarted?: (session: GuideSession) => void;
	onSessionEnded?: (recordingId: unknown) => void;
}

export function registerGuideIpcHandlers(
	ipcMain: IpcMain,
	store: GuideStore,
	aiSettingsStore?: DeepSeekSettingsStore,
	lifecycle: GuideIpcLifecycle = {},
): void {
	ipcMain.handle(
		"guide:start-session",
		async (_, recordingId): Promise<GuideIpcResult<GuideSession>> => {
			const result = await toGuideResult(() => store.startSession(recordingId));
			if (result.success) {
				lifecycle.onSessionStarted?.(result.data);
			}
			return result;
		},
	);

	ipcMain.handle(
		"guide:read-session",
		async (_, recordingId): Promise<GuideIpcResult<GuideSession>> => {
			return await toGuideResult(() => store.readSession(recordingId));
		},
	);

	ipcMain.handle(
		"guide:add-marker",
		async (
			_,
			input: AddGuideMarkerInput,
		): Promise<GuideIpcResult<{ session: GuideSession; event: GuideEvent }>> => {
			return await toGuideResult(() => store.addMarker(input));
		},
	);

	ipcMain.handle(
		"guide:finalize-events",
		async (_, input: FinalizeGuideEventsInput): Promise<GuideIpcResult<GuideSession>> => {
			const result = await toGuideResult(() => store.finalizeEvents(input));
			if (result.success) {
				lifecycle.onSessionEnded?.(input.recordingId);
			}
			return result;
		},
	);

	ipcMain.handle(
		"guide:write-snapshot",
		async (_, input: WriteGuideSnapshotInput): Promise<GuideIpcResult<GuideSession>> => {
			return await toGuideResult(() => store.writeSnapshot(input));
		},
	);

	ipcMain.handle(
		"guide:run-ocr",
		async (_, input: RunGuideOcrInput): Promise<GuideIpcResult<GuideSession>> => {
			return await toGuideResult(() => store.runOcr(input));
		},
	);

	ipcMain.handle(
		"guide:generate-draft",
		async (_, input: GenerateGuideDraftInput): Promise<GuideIpcResult<GuideSession>> => {
			return await toGuideResult(() => store.generateDraft(input));
		},
	);

	ipcMain.handle("guide:get-ai-settings", async (): Promise<GuideIpcResult<GuideAiSettings>> => {
		return await toGuideResult(() => requireAiSettingsStore(aiSettingsStore).getStatus());
	});

	ipcMain.handle(
		"guide:save-ai-settings",
		async (_, input: SaveGuideAiSettingsInput): Promise<GuideIpcResult<GuideAiSettings>> => {
			return await toGuideResult(() => requireAiSettingsStore(aiSettingsStore).save(input));
		},
	);

	ipcMain.handle(
		"guide:save-guide",
		async (_, input: SaveGuideInput): Promise<GuideIpcResult<GuideSession>> => {
			return await toGuideResult(() => store.saveGuide(input));
		},
	);

	ipcMain.handle(
		"guide:export-markdown",
		async (_, input: ExportGuideInput): Promise<GuideIpcResult<ExportGuideResult>> => {
			return await toGuideResult(() => store.exportMarkdown(input));
		},
	);

	ipcMain.handle(
		"guide:export-html",
		async (_, input: ExportGuideInput): Promise<GuideIpcResult<ExportGuideResult>> => {
			return await toGuideResult(() => store.exportHtml(input));
		},
	);

	ipcMain.handle(
		"guide:discard-session",
		async (_, input: DiscardGuideSessionInput): Promise<GuideIpcResult<{ discarded: true }>> => {
			const result = await toGuideResult(async () => {
				await store.discardSession(input);
				return { discarded: true as const };
			});
			if (result.success) {
				lifecycle.onSessionEnded?.(input.recordingId);
			}
			return result;
		},
	);
}

function requireAiSettingsStore(store: DeepSeekSettingsStore | undefined): DeepSeekSettingsStore {
	if (!store) {
		throw new GuideStoreError("guide-internal-error", "Guide AI settings store is unavailable.");
	}
	return store;
}

async function toGuideResult<TData>(action: () => Promise<TData>): Promise<GuideIpcResult<TData>> {
	try {
		return {
			success: true,
			data: await action(),
		};
	} catch (error) {
		if (error instanceof GuideStoreError) {
			return {
				success: false,
				code: error.code,
				error: error.message,
				retryable: error.retryable,
			};
		}

		console.error("Guide IPC failed:", error);
		return {
			success: false,
			code: "guide-internal-error",
			error: error instanceof Error ? error.message : String(error),
			retryable: false,
		};
	}
}
