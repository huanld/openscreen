import { app, ipcMain } from "electron";
import {
	type KdenliveOtioExportRequest,
	NATIVE_BRIDGE_CHANNEL,
	NATIVE_BRIDGE_VERSION,
	type NativeBridgeErrorCode,
	type NativeBridgeRequest,
	type NativeBridgeResponse,
	type NativePlatform,
	type ProjectFileResult,
	type ProjectPathResult,
} from "../../src/native/contracts";
import type { CursorTelemetryLoadResult } from "../native-bridge/cursor/adapter";
import { TelemetryCursorAdapter } from "../native-bridge/cursor/telemetryCursorAdapter";
import { CursorService } from "../native-bridge/services/cursorService";
import { ProjectService } from "../native-bridge/services/projectService";
import { ScreenshotError } from "../native-bridge/services/screenshotImage";
import { ScreenshotOcrService } from "../native-bridge/services/screenshotOcrService";
import { ScreenshotService } from "../native-bridge/services/screenshotService";
import { SystemService } from "../native-bridge/services/systemService";
import { NativeBridgeStateStore } from "../native-bridge/store";
import {
	activateScreenshotRegionWindow,
	createScreenshotRegionWindow,
	createScreenshotWindow,
} from "../windows";

export interface NativeBridgeContext {
	getPlatform: () => NodeJS.Platform;
	getCurrentProjectPath: () => string | null;
	getCurrentVideoPath: () => string | null;
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
	) => Promise<ProjectFileResult>;
	exportKdenliveOtio: (request: KdenliveOtioExportRequest) => Promise<ProjectFileResult>;
	loadProjectFile: () => Promise<ProjectFileResult>;
	loadProjectFileFromPath: (path: string) => Promise<ProjectFileResult>;
	loadCurrentProjectFile: () => Promise<ProjectFileResult>;
	setCurrentVideoPath: (path: string) => ProjectPathResult | Promise<ProjectPathResult>;
	getCurrentVideoPathResult: () => ProjectPathResult;
	clearCurrentVideoPath: () => ProjectPathResult;
	resolveAssetBasePath: () => string | null;
	resolveVideoPath: (videoPath?: string | null) => string | null;
	loadCursorRecordingData: (
		videoPath: string,
	) => Promise<import("../../src/native/contracts").CursorRecordingData>;
	loadCursorTelemetry: (videoPath: string) => Promise<CursorTelemetryLoadResult>;
	/** Hides the tray icon while a screen is captured; returns the restore call. */
	suppressTrayIcon?: () => () => void;
}

function normalizePlatform(platform: NodeJS.Platform): NativePlatform {
	if (platform === "darwin" || platform === "win32") {
		return platform;
	}

	return "linux";
}

function createMeta(requestId?: string) {
	return {
		version: NATIVE_BRIDGE_VERSION,
		requestId: requestId || `native-${Date.now()}`,
		timestampMs: Date.now(),
	} as const;
}

function createSuccessResponse<TData>(requestId: string | undefined, data: TData) {
	return {
		ok: true,
		data,
		meta: createMeta(requestId),
	} satisfies NativeBridgeResponse<TData>;
}

function createErrorResponse(
	requestId: string | undefined,
	code: NativeBridgeErrorCode,
	message: string,
	retryable = false,
) {
	return {
		ok: false,
		error: {
			code,
			message,
			retryable,
		},
		meta: createMeta(requestId),
	} satisfies NativeBridgeResponse;
}

function isBridgeRequest(value: unknown): value is NativeBridgeRequest {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<NativeBridgeRequest>;
	return typeof candidate.domain === "string" && typeof candidate.action === "string";
}

export function registerNativeBridgeHandlers(context: NativeBridgeContext) {
	ipcMain.removeHandler(NATIVE_BRIDGE_CHANNEL);

	const platform = normalizePlatform(context.getPlatform());
	const store = new NativeBridgeStateStore(platform);
	const screenshotService = new ScreenshotService({
		openWindow: createScreenshotWindow,
		openRegionWindow: createScreenshotRegionWindow,
		activateRegionWindow: activateScreenshotRegionWindow,
		suppressTray: context.suppressTrayIcon,
	});
	const screenshotOcrService = new ScreenshotOcrService();
	app.once("before-quit", () => {
		void screenshotOcrService.dispose();
	});
	const projectService = new ProjectService({
		store,
		getCurrentProjectPath: context.getCurrentProjectPath,
		getCurrentVideoPath: context.getCurrentVideoPath,
		saveProjectFile: context.saveProjectFile,
		exportKdenliveOtio: context.exportKdenliveOtio,
		loadProjectFile: context.loadProjectFile,
		loadProjectFileFromPath: context.loadProjectFileFromPath,
		loadCurrentProjectFile: context.loadCurrentProjectFile,
		setCurrentVideoPath: context.setCurrentVideoPath,
		getCurrentVideoPathResult: context.getCurrentVideoPathResult,
		clearCurrentVideoPath: context.clearCurrentVideoPath,
	});
	const cursorService = new CursorService({
		store,
		adapter: new TelemetryCursorAdapter({
			loadRecordingData: context.loadCursorRecordingData,
			resolveVideoPath: context.resolveVideoPath,
			loadTelemetry: context.loadCursorTelemetry,
		}),
	});
	const systemService = new SystemService({
		store,
		getPlatform: () => platform,
		getAssetBasePath: context.resolveAssetBasePath,
		getCursorCapabilities: () => cursorService.getCapabilities(),
	});

	ipcMain.handle(NATIVE_BRIDGE_CHANNEL, async (event, request: unknown) => {
		if (!isBridgeRequest(request)) {
			return createErrorResponse(undefined, "INVALID_REQUEST", "Invalid native bridge request.");
		}

		const requestId = request.requestId;
		const domain = request.domain as string;

		try {
			switch (request.domain) {
				case "screenshot": {
					const action = request.action as string;
					switch (request.action) {
						case "captureRegion":
							return createSuccessResponse(
								requestId,
								await screenshotService.captureRegion(request.payload?.sourceId, event.sender),
							);
						case "getRegionSelection":
							return createSuccessResponse(
								requestId,
								screenshotService.getRegionSelection(event.sender),
							);
						case "completeRegionSelection":
							return createSuccessResponse(
								requestId,
								screenshotService.completeRegionSelection(request.payload?.region, event.sender),
							);
						case "openWindow":
							return createSuccessResponse(requestId, screenshotService.openWindow());
						case "capture":
							return createSuccessResponse(
								requestId,
								await screenshotService.capture(request.payload?.sourceId),
							);
						case "openImage":
							return createSuccessResponse(
								requestId,
								await screenshotService.openImage(event.sender),
							);
						case "saveImage":
							return createSuccessResponse(
								requestId,
								await screenshotService.saveImage(
									request.payload?.dataUrl,
									request.payload?.format,
									event.sender,
								),
							);
						case "copyImage":
							return createSuccessResponse(
								requestId,
								screenshotService.copyImage(request.payload?.dataUrl),
							);
						case "recognizeText":
							return createSuccessResponse(
								requestId,
								await screenshotOcrService.recognizeText(request.payload?.dataUrl),
							);
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported screenshot action: ${action}`,
							);
					}
				}
				case "system": {
					const action = request.action as string;
					switch (request.action) {
						case "getPlatform":
							return createSuccessResponse(requestId, systemService.getPlatform());
						case "getAssetBasePath":
							return createSuccessResponse(requestId, systemService.getAssetBasePath());
						case "getCapabilities":
							return createSuccessResponse(requestId, await systemService.getCapabilities());
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported system action: ${action}`,
							);
					}
				}

				case "project": {
					const action = request.action as string;
					switch (request.action) {
						case "getCurrentContext":
							return createSuccessResponse(requestId, projectService.getCurrentContext());
						case "saveProjectFile":
							return createSuccessResponse(
								requestId,
								await projectService.saveProjectFile(
									request.payload.projectData,
									request.payload.suggestedName,
									request.payload.existingProjectPath,
								),
							);
						case "exportKdenliveOtio":
							return createSuccessResponse(
								requestId,
								await projectService.exportKdenliveOtio(request.payload),
							);
						case "loadProjectFile":
							return createSuccessResponse(requestId, await projectService.loadProjectFile());
						case "loadCurrentProjectFile":
							return createSuccessResponse(
								requestId,
								await projectService.loadCurrentProjectFile(),
							);
						case "setCurrentVideoPath":
							return createSuccessResponse(
								requestId,
								await projectService.setCurrentVideoPath(request.payload.path),
							);
						case "getCurrentVideoPath":
							return createSuccessResponse(requestId, projectService.getCurrentVideoPath());
						case "clearCurrentVideoPath":
							return createSuccessResponse(requestId, projectService.clearCurrentVideoPath());
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported project action: ${action}`,
							);
					}
				}

				case "cursor": {
					const action = request.action as string;
					switch (request.action) {
						case "getCapabilities":
							return createSuccessResponse(requestId, await cursorService.getCapabilities());
						case "getTelemetry":
							return createSuccessResponse(
								requestId,
								await cursorService.getTelemetry(request.payload?.videoPath),
							);
						case "getRecordingData":
							return createSuccessResponse(
								requestId,
								await cursorService.getRecordingData(request.payload?.videoPath),
							);
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported cursor action: ${action}`,
							);
					}
				}

				default:
					return createErrorResponse(
						requestId,
						"UNSUPPORTED_ACTION",
						`Unsupported bridge domain: ${domain}`,
					);
			}
		} catch (error) {
			if (error instanceof ScreenshotError) {
				return createErrorResponse(requestId, error.code, error.message, error.retryable);
			}
			return createErrorResponse(
				requestId,
				"INTERNAL_ERROR",
				error instanceof Error ? error.message : "Unknown native bridge error.",
				true,
			);
		}
	});
}
