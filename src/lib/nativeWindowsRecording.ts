export type NativeWindowsSourceType = "display" | "window";

export type NativeWindowsRecordingRequest = {
	recordingId?: number;
	source: {
		type: NativeWindowsSourceType;
		sourceId: string;
		displayId?: number;
		bounds?: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		windowHandle?: string;
	};
	video: {
		fps: number;
		width: number;
		height: number;
	};
	audio: {
		system: {
			enabled: boolean;
		};
		microphone: {
			enabled: boolean;
			deviceId?: string;
			deviceName?: string;
			gain: number;
		};
	};
	webcam: {
		enabled: boolean;
		deviceId?: string;
		deviceName?: string;
		directShowClsid?: string;
		width: number;
		height: number;
		fps: number;
	};
	cursor: {
		mode: import("./recordingSession").CursorCaptureMode;
	};
};

export type NativeWindowsRecordingStartResult = {
	success: boolean;
	recordingId?: number;
	path?: string;
	helperPath?: string;
	error?: string;
};

export type NativeWindowsRecordingStopResult = {
	success: boolean;
	path?: string;
	session?: import("./recordingSession").RecordingSession;
	message?: string;
	warning?: string;
	discarded?: boolean;
	recovered?: boolean;
	ended?: boolean;
	code?: "NATIVE_CAPTURE_NOT_RUNNING" | "NATIVE_CAPTURE_STOP_FAILED";
	error?: string;
};

export type NativeWindowsRecordingEndedEvent = {
	recordingId: number;
	error: string;
};

export type NativeWindowsRecordingState = {
	state: "idle" | "running" | "ended";
	recordingId?: number;
	paused?: boolean;
	error?: string;
};

export function shouldClearNativeWindowsRecordingAfterStop(
	result: NativeWindowsRecordingStopResult,
) {
	return !result.success;
}

export function parseWindowHandleFromSourceId(sourceId?: string | null) {
	if (!sourceId?.startsWith("window:")) {
		return null;
	}

	const handlePart = sourceId.split(":")[1];
	if (!handlePart || !/^\d+$/.test(handlePart)) {
		return null;
	}

	return handlePart;
}
