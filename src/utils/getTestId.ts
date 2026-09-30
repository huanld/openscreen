export type TestId =
	| `gif-size-button-${string}`
	| "export-button"
	| "export-kdenlive-button"
	| "export-panel-button"
	| "gif-format-button"
	| "export-video-only-switch"
	| "settings-mode-rail"
	| "settings-panel-shell"
	| "mp4-format-button";

export function getTestId(testId: TestId) {
	return `testId-${testId}`;
}
