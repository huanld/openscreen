import { describe, expect, it } from "vitest";
import {
	appendNativeWindowsCaptureOutput,
	describeNativeWindowsCaptureExit,
	didNativeWindowsCaptureFinalizeOutput,
	getNativeWindowsCaptureStopDisposition,
	getNativeWindowsCaptureStoppedPath,
	NATIVE_WINDOWS_CAPTURE_STOP_TIMEOUT_MS,
} from "./nativeWindowsCaptureState";

describe("native Windows capture state", () => {
	it("distinguishes a running helper from an ended or missing helper", () => {
		expect(
			getNativeWindowsCaptureStopDisposition({
				hasProcess: true,
				exitCode: null,
				killed: false,
				unexpectedExit: null,
			}),
		).toBe("running");
		expect(
			getNativeWindowsCaptureStopDisposition({
				hasProcess: true,
				exitCode: 1,
				killed: false,
				unexpectedExit: null,
			}),
		).toBe("ended");
		expect(
			getNativeWindowsCaptureStopDisposition({
				hasProcess: false,
				exitCode: null,
				killed: false,
				unexpectedExit: null,
			}),
		).toBe("missing");
	});

	it("treats an error event as terminal before the close event arrives", () => {
		expect(
			getNativeWindowsCaptureStopDisposition({
				hasProcess: true,
				exitCode: null,
				killed: false,
				unexpectedExit: {
					code: null,
					signal: null,
					error: "command channel closed",
				},
			}),
		).toBe("ended");
	});

	it("keeps post-start stderr and surfaces the final native diagnostic", () => {
		const output = appendNativeWindowsCaptureOutput(
			'Recording started\n{"event":"recording-started"}\n',
			"ERROR: Failed to encode WGC frame\n",
		);
		expect(describeNativeWindowsCaptureExit({ code: 1, signal: null }, output)).toContain(
			"ERROR: Failed to encode WGC frame",
		);
	});

	it("bounds helper output while retaining the newest diagnostics", () => {
		const output = appendNativeWindowsCaptureOutput("x".repeat(300_000), "FINAL ERROR");
		expect(output.length).toBeLessThanOrEqual(256 * 1024);
		expect(output.endsWith("FINAL ERROR")).toBe(true);
	});

	it("only recovers output when the helper reached a known finalize path", () => {
		expect(
			didNativeWindowsCaptureFinalizeOutput(
				{ code: 1, signal: null },
				"ERROR: Failed to encode WGC frame",
			),
		).toBe(true);
		expect(didNativeWindowsCaptureFinalizeOutput({ code: 0, signal: null }, "")).toBe(true);
		expect(didNativeWindowsCaptureFinalizeOutput({ code: 3221225477, signal: null }, "")).toBe(
			false,
		);
		expect(
			didNativeWindowsCaptureFinalizeOutput(
				{ code: 1, signal: null },
				"ERROR: Failed to finalize WGC screen output",
			),
		).toBe(false);
		expect(
			didNativeWindowsCaptureFinalizeOutput(
				{ code: null, signal: null },
				'{"event":"recording-finalized","schemaVersion":2,"screenPath":"C:\\\\recordings\\\\safe.mp4"}',
			),
		).toBe(true);
	});

	it("allows enough time for Media Foundation to finalize on slower Windows machines", () => {
		expect(NATIVE_WINDOWS_CAPTURE_STOP_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
	});

	it("recognizes a complete finalized event with JSON whitespace", () => {
		expect(
			didNativeWindowsCaptureFinalizeOutput(
				{ code: null, signal: null },
				'{"event": "recording-finalized", "schemaVersion": 2, "screenPath": "C:\\\\recordings\\\\safe.mp4"}\n',
			),
		).toBe(true);
	});

	it("does not recover output from incomplete or invalid finalized events", () => {
		for (const output of [
			'{"event":"recording-finalized","screenPath":"C:',
			'{"event":"recording-finalized"}',
			'{"event":"recording-finalized","screenPath":null}',
			'{"event":"recording-finalized","screenPath":"   "}',
			'Diagnostic mentioning "event":"recording-finalized"',
		]) {
			expect(didNativeWindowsCaptureFinalizeOutput({ code: null, signal: null }, output)).toBe(
				false,
			);
		}
	});

	it("resolves finalized output from either helper protocol", () => {
		expect(
			getNativeWindowsCaptureStoppedPath({
				code: 1,
				output: "Recording stopped. Output path: C:\\recordings\\legacy.mp4\r\n",
				preferredPath: null,
			}),
		).toBe("C:\\recordings\\legacy.mp4");
		expect(
			getNativeWindowsCaptureStoppedPath({
				code: null,
				output:
					'{"event":"recording-stopped","schemaVersion":2,"screenPath":"C:\\\\recordings\\\\event.mp4"}\n',
				preferredPath: null,
			}),
		).toBe("C:\\recordings\\event.mp4");
		expect(
			getNativeWindowsCaptureStoppedPath({
				code: null,
				output:
					'{"event":"recording-finalized","schemaVersion":2,"screenPath":"C:\\\\recordings\\\\finalized.mp4"}\n',
				preferredPath: null,
			}),
		).toBe("C:\\recordings\\finalized.mp4");
	});

	it("uses the preferred path only after a clean helper exit", () => {
		expect(
			getNativeWindowsCaptureStoppedPath({
				code: 0,
				output: "",
				preferredPath: "C:\\recordings\\preferred.mp4",
			}),
		).toBe("C:\\recordings\\preferred.mp4");
		expect(
			getNativeWindowsCaptureStoppedPath({
				code: 1,
				output: "ERROR: Failed to finalize WGC screen output",
				preferredPath: "C:\\recordings\\unfinished.mp4",
			}),
		).toBeNull();
	});
});
