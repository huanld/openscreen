import {
	type CursorCapabilities,
	type CursorRecordingData,
	type CursorTelemetryPoint,
	type KdenliveOtioExportRequest,
	NATIVE_BRIDGE_CHANNEL,
	type NativeBridgeRequest,
	type NativeBridgeResponse,
	type NativePlatform,
	type ProjectContext,
	type ProjectFileResult,
	type ProjectPathResult,
	type ScreenshotFormat,
	type ScreenshotImage,
	type ScreenshotOcrResult,
	type ScreenshotRegion,
	type ScreenshotSaveResult,
	type SystemCapabilities,
} from "./contracts";

function createRequestId() {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}

	return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getElectronBridge() {
	if (!window.electronAPI?.invokeNativeBridge) {
		throw new Error(
			`Native bridge unavailable. Expected ${NATIVE_BRIDGE_CHANNEL} transport in preload.`,
		);
	}

	return window.electronAPI.invokeNativeBridge;
}

export async function invokeNativeBridge<TData = unknown>(
	request: NativeBridgeRequest,
): Promise<NativeBridgeResponse<TData>> {
	const invoke = getElectronBridge();
	return invoke({
		...request,
		requestId: request.requestId ?? createRequestId(),
	});
}

export async function requireNativeBridgeData<TData>(request: NativeBridgeRequest): Promise<TData> {
	const response = await invokeNativeBridge<TData>(request);
	if (!response.ok) {
		throw new Error(response.error.message);
	}

	return response.data;
}

export const nativeBridgeClient = {
	rawInvoke: invokeNativeBridge,
	screenshot: {
		captureRegion: (sourceId?: string) =>
			requireNativeBridgeData<ScreenshotImage | null>({
				domain: "screenshot",
				action: "captureRegion",
				payload: { sourceId },
			}),
		getRegionSelection: () =>
			requireNativeBridgeData<ScreenshotImage | null>({
				domain: "screenshot",
				action: "getRegionSelection",
			}),
		completeRegionSelection: (region: ScreenshotRegion | null) =>
			requireNativeBridgeData<void>({
				domain: "screenshot",
				action: "completeRegionSelection",
				payload: { region },
			}),
		openWindow: () => requireNativeBridgeData<void>({ domain: "screenshot", action: "openWindow" }),
		capture: (sourceId: string) =>
			requireNativeBridgeData<ScreenshotImage>({
				domain: "screenshot",
				action: "capture",
				payload: { sourceId },
			}),
		openImage: () =>
			requireNativeBridgeData<ScreenshotImage | null>({
				domain: "screenshot",
				action: "openImage",
			}),
		saveImage: (dataUrl: string, format: ScreenshotFormat) =>
			requireNativeBridgeData<ScreenshotSaveResult>({
				domain: "screenshot",
				action: "saveImage",
				payload: { dataUrl, format },
			}),
		copyImage: (dataUrl: string) =>
			requireNativeBridgeData<void>({
				domain: "screenshot",
				action: "copyImage",
				payload: { dataUrl },
			}),
		recognizeText: (dataUrl: string) =>
			requireNativeBridgeData<ScreenshotOcrResult>({
				domain: "screenshot",
				action: "recognizeText",
				payload: { dataUrl },
			}),
	},
	system: {
		getPlatform: () =>
			requireNativeBridgeData<NativePlatform>({
				domain: "system",
				action: "getPlatform",
			}),
		getAssetBasePath: () =>
			requireNativeBridgeData<string | null>({
				domain: "system",
				action: "getAssetBasePath",
			}),
		getCapabilities: () =>
			requireNativeBridgeData<SystemCapabilities>({
				domain: "system",
				action: "getCapabilities",
			}),
	},
	project: {
		getCurrentContext: () =>
			requireNativeBridgeData<ProjectContext>({
				domain: "project",
				action: "getCurrentContext",
			}),
		saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) =>
			requireNativeBridgeData<ProjectFileResult>({
				domain: "project",
				action: "saveProjectFile",
				payload: {
					projectData,
					suggestedName,
					existingProjectPath,
				},
			}),
		exportKdenliveOtio: (request: KdenliveOtioExportRequest) =>
			requireNativeBridgeData<ProjectFileResult>({
				domain: "project",
				action: "exportKdenliveOtio",
				payload: request,
			}),
		loadProjectFile: (projectFolder?: string) =>
			requireNativeBridgeData<ProjectFileResult>({
				domain: "project",
				action: "loadProjectFile",
				payload: { projectFolder },
			}),
		loadCurrentProjectFile: () =>
			requireNativeBridgeData<ProjectFileResult>({
				domain: "project",
				action: "loadCurrentProjectFile",
			}),
		loadProjectFileFromPath: (path: string) =>
			requireNativeBridgeData<ProjectFileResult>({
				domain: "project",
				action: "loadProjectFileFromPath",
				payload: { path },
			}),
		setCurrentVideoPath: (path: string) =>
			requireNativeBridgeData<ProjectPathResult>({
				domain: "project",
				action: "setCurrentVideoPath",
				payload: { path },
			}),
		getCurrentVideoPath: () =>
			requireNativeBridgeData<ProjectPathResult>({
				domain: "project",
				action: "getCurrentVideoPath",
			}),
		clearCurrentVideoPath: () =>
			requireNativeBridgeData<ProjectPathResult>({
				domain: "project",
				action: "clearCurrentVideoPath",
			}),
	},
	cursor: {
		getCapabilities: () =>
			requireNativeBridgeData<CursorCapabilities>({
				domain: "cursor",
				action: "getCapabilities",
			}),
		getRecordingData: (videoPath?: string) =>
			requireNativeBridgeData<CursorRecordingData>({
				domain: "cursor",
				action: "getRecordingData",
				payload: videoPath ? { videoPath } : {},
			}),
		getTelemetry: (videoPath?: string) =>
			requireNativeBridgeData<CursorTelemetryPoint[]>({
				domain: "cursor",
				action: "getTelemetry",
				payload: videoPath ? { videoPath } : {},
			}),
	},
};
