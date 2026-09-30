const MAX_NATIVE_WINDOWS_CAPTURE_OUTPUT_CHARS = 256 * 1024;

export type NativeWindowsCaptureUnexpectedExit = {
	code: number | null;
	signal: NodeJS.Signals | null;
	error?: string;
};

export type NativeWindowsCaptureStopDisposition = "running" | "ended" | "missing";

export function appendNativeWindowsCaptureOutput(current: string, chunk: string) {
	const combined = current + chunk;
	if (combined.length <= MAX_NATIVE_WINDOWS_CAPTURE_OUTPUT_CHARS) {
		return combined;
	}
	return combined.slice(-MAX_NATIVE_WINDOWS_CAPTURE_OUTPUT_CHARS);
}

export function getNativeWindowsCaptureStopDisposition(input: {
	hasProcess: boolean;
	exitCode: number | null;
	killed: boolean;
	unexpectedExit: NativeWindowsCaptureUnexpectedExit | null;
}): NativeWindowsCaptureStopDisposition {
	if (!input.hasProcess) {
		return "missing";
	}
	if (input.unexpectedExit || input.exitCode !== null || input.killed) {
		return "ended";
	}
	return "running";
}

export function describeNativeWindowsCaptureExit(
	exit: NativeWindowsCaptureUnexpectedExit | null,
	output: string,
) {
	const diagnosticLines = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-8);
	const diagnostic = diagnosticLines.join(" | ");
	const exitReason = exit?.error
		? exit.error
		: `code=${exit?.code ?? "unknown"}${exit?.signal ? `, signal=${exit.signal}` : ""}`;
	return diagnostic
		? `Native Windows capture ended unexpectedly (${exitReason}). ${diagnostic}`
		: `Native Windows capture ended unexpectedly (${exitReason}).`;
}

export function didNativeWindowsCaptureFinalizeOutput(
	exit: NativeWindowsCaptureUnexpectedExit | null,
	output: string,
) {
	return (
		exit?.code === 0 ||
		output.includes("Recording stopped. Output path:") ||
		output.includes("ERROR: Failed to encode WGC frame")
	);
}
