import { describe, expect, it } from "vitest";
import { shouldClearNativeWindowsRecordingAfterStop } from "./nativeWindowsRecording";

describe("native Windows recording stop result", () => {
	it("clears stale renderer state after a terminal native failure", () => {
		expect(
			shouldClearNativeWindowsRecordingAfterStop({
				success: false,
				ended: true,
				code: "NATIVE_CAPTURE_NOT_RUNNING",
			}),
		).toBe(true);
	});

	it("clears state for every failed stop because the webcam finalizer has already started", () => {
		expect(shouldClearNativeWindowsRecordingAfterStop({ success: false })).toBe(true);
	});

	it("does not clear a recovered recording", () => {
		expect(shouldClearNativeWindowsRecordingAfterStop({ success: true, recovered: true })).toBe(
			false,
		);
	});
});
