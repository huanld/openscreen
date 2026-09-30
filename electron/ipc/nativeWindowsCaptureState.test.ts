import { describe, expect, it } from "vitest";
import {
	appendNativeWindowsCaptureOutput,
	describeNativeWindowsCaptureExit,
	didNativeWindowsCaptureFinalizeOutput,
	getNativeWindowsCaptureStopDisposition,
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
	});
});
