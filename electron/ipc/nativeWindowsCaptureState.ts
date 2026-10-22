const MAX_NATIVE_WINDOWS_CAPTURE_OUTPUT_CHARS = 256 * 1024;

// Media Foundation can take noticeably longer to flush and write the MP4 index
// on older Windows 10 machines, especially for long recordings. Killing the
// helper after 15 seconds leaves an otherwise valid recording unfinished.
export const NATIVE_WINDOWS_CAPTURE_STOP_TIMEOUT_MS = 120_000;

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
		getNativeWindowsCaptureStoppedPath({ code: null, output, preferredPath: null }) !== null ||
		output.includes("ERROR: Failed to encode WGC frame")
	);
}

export function getNativeWindowsCaptureStoppedPath(input: {
	code: number | null;
	output: string;
	preferredPath: string | null;
}) {
	const lines = input.output.split(/\r?\n/).reverse();
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const legacyPrefix = "Recording stopped. Output path:";
		if (line.startsWith(legacyPrefix)) {
			const stoppedPath = line.slice(legacyPrefix.length).trim();
			if (stoppedPath) {
				return stoppedPath;
			}
		}

		if (line.startsWith("{") && line.endsWith("}")) {
			try {
				const event = JSON.parse(line) as { event?: unknown; screenPath?: unknown };
				if (
					(event.event === "recording-finalized" || event.event === "recording-stopped") &&
					typeof event.screenPath === "string" &&
					event.screenPath.trim()
				) {
					return event.screenPath.trim();
				}
			} catch {
				// Ignore non-event diagnostics that happen to use braces.
			}
		}
	}

	return input.code === 0 ? input.preferredPath : null;
}
