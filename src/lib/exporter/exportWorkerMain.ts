/// <reference lib="webworker" />
import type { AnnotationRegion } from "@/components/video-editor/types";
import type { WorkerInboundMessage, WorkerOutboundMessage } from "./exportWorkerProtocol";
import { VideoExporter } from "./videoExporter";

const post = (message: WorkerOutboundMessage) => {
	self.postMessage(message);
};

let exporter: VideoExporter | null = null;

/** Message handler exported for the buffering entry module. */
export function handleWorkerMessage(event: MessageEvent): void {
	const message = event.data as WorkerInboundMessage | undefined;
	if (!message || typeof message !== "object") return;
	switch (message.type) {
		case "run":
			void handleRun(message);
			break;
		case "audio-chunk":
			exporter?.addExternalAudioChunk(message.chunk, message.meta);
			break;
		case "audio-complete":
			exporter?.completeExternalAudio();
			break;
		case "audio-error":
			exporter?.failExternalAudio(message.message);
			break;
		case "cancel":
			exporter?.cancel();
			break;
	}
}

async function handleRun(message: Extract<WorkerInboundMessage, { type: "run" }>) {
	try {
		// Constructed synchronously FIRST so audio chunks streaming in during
		// the font preload below are buffered instead of dropped.
		exporter = new VideoExporter({
			...message.config,
			sourceBlob: new Blob([message.sourceBuffer]),
			...(message.webcamBuffer ? { webcamBlob: new Blob([message.webcamBuffer]) } : {}),
			...(message.regionBuffers?.length
				? {
						videoRegionBlobs: new Map(
							message.regionBuffers.map((region) => [region.sourcePath, new Blob([region.buffer])]),
						),
					}
				: {}),
			wasmUrl: message.wasmUrl,
			platform: message.platform,
			...(message.audioCodec ? { externalAudio: { codec: message.audioCodec } } : {}),
			// Never spawn a worker from inside the worker.
			disableWorkerExport: true,
			onProgress: (progress) => post({ type: "progress", progress }),
		});

		// Annotation text needs the same webfonts the editor uses; the worker's
		// font set is empty otherwise and text would silently fall back.
		await preloadAnnotationFonts(message.config.annotationRegions);

		const result = await exporter.export();
		post({ type: "done", result });
	} catch (error) {
		post({
			type: "error",
			message: `${error instanceof Error ? error.message : String(error)}${error instanceof Error && error.stack ? `\n${error.stack}` : ""}`,
		});
	} finally {
		exporter = null;
	}
}

const FONT_CSS_BASE = "https://fonts.googleapis.com/css2";
const FONT_LOAD_TIMEOUT_MS = 15_000;

/**
 * Registers the annotation webfonts inside the worker. Best-effort: offline or
 * slow CDN falls back to the default font after the timeout, matching how the
 * main thread degrades without network access.
 */
async function preloadAnnotationFonts(annotations: readonly AnnotationRegion[] | undefined) {
	if (typeof FontFace === "undefined" || typeof self.fonts?.add !== "function") return;
	const families = new Set<string>(["Inter"]);
	for (const annotation of annotations ?? []) {
		if (annotation.style?.fontFamily) families.add(annotation.style.fontFamily);
	}
	try {
		await Promise.race([
			Promise.all([...families].map((family) => loadFamily(family))),
			new Promise((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
		]);
	} catch {
		// Font failures must never fail the export.
	}
}

async function loadFamily(family: string) {
	const url = `${FONT_CSS_BASE}?family=${encodeURIComponent(family)}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
	const response = await fetch(url);
	if (!response.ok) return;
	const css = await response.text();
	const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
	const registrations: Promise<void>[] = [];
	for (const match of css.matchAll(fontFaceRegex)) {
		const block = match[1];
		const familyMatch = /font-family:\s*['"]([^'"]+)['"]/.exec(block);
		const srcMatch = /src:\s*url\(([^)]+)\)/.exec(block);
		if (!familyMatch || !srcMatch) continue;
		const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal";
		const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "400";
		const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
		const face = new FontFace(familyMatch[1], `url(${srcMatch[1]})`, {
			style,
			weight,
			...(unicodeRange ? { unicodeRange } : {}),
		});
		registrations.push(
			face
				.load()
				.then((loaded) => {
					self.fonts.add(loaded);
				})
				.catch(() => undefined),
		);
	}
	await Promise.all(registrations);
}
