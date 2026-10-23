/// <reference lib="webworker" />
export {};

/**
 * Export worker entry. web-demuxer's worker bootstrap only takes its
 * same-origin blob-URL path when `window` exists; in a worker it falls back
 * to a data:-URL worker whose opaque origin cannot fetch the demuxer wasm
 * ("Failed to fetch"). Aliasing `window` to the worker global first makes
 * web-demuxer create a blob-URL worker that inherits this worker's origin.
 *
 * The main module loads dynamically so this shim runs first; messages that
 * arrive mid-import are buffered and replayed through the exported handler.
 */
if (typeof window === "undefined") {
	(self as unknown as { window: unknown }).window = self;
}

const buffered: MessageEvent[] = [];
let mainHandler: ((event: MessageEvent) => void) | null = null;

self.addEventListener("message", (event: MessageEvent) => {
	if (mainHandler) {
		mainHandler(event);
	} else {
		buffered.push(event);
	}
});

const main = await import("./exportWorkerMain");
mainHandler = main.handleWorkerMessage;
for (const event of buffered.splice(0)) {
	mainHandler(event);
}
