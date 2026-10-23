import { AudioProcessor, type ExportAudioCodec, type ExternalAudioTrack } from "./audioEncoder";
import type {
	WorkerInboundMessage,
	WorkerOutboundMessage,
	WorkerRunMessage,
} from "./exportWorkerProtocol";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type { ExportResult } from "./types";
import type { VideoExporterConfig } from "./videoExporter";

/**
 * Runs the MP4 export pipeline inside a dedicated Web Worker: video
 * decode/render/encode/mux happens off the UI thread while audio — whose
 * pipeline needs DOM media elements (OfflineAudioContext, <audio>/<video>
 * clocks) — is processed on the main thread and streamed into the worker as
 * encoded chunks. Returns null when the worker path cannot even start (file
 * preload failure), letting the caller fall back to the in-page pipeline.
 */
export class WorkerExportRunner {
	private worker: Worker | null = null;
	private audioProcessor: AudioProcessor | null = null;
	private cancelled = false;

	cancel(): void {
		this.cancelled = true;
		this.audioProcessor?.cancel();
		this.worker?.postMessage({ type: "cancel" } satisfies WorkerInboundMessage);
	}

	async run(config: VideoExporterConfig): Promise<ExportResult | null> {
		const source = await preloadArrayBuffer(config.videoUrl);
		if (!source) return null;

		let webcam: ArrayBuffer | null = null;
		if (config.webcamVideoUrl) {
			webcam = await preloadArrayBuffer(config.webcamVideoUrl);
			if (!webcam) return null;
		}

		const regionBuffers: { sourcePath: string; buffer: ArrayBuffer }[] = [];
		const regionPaths = [
			...new Set((config.videoRegions ?? []).map((region) => region.sourcePath)),
		];
		for (const sourcePath of regionPaths) {
			const buffer = await preloadArrayBuffer(sourcePath);
			if (!buffer) return null;
			regionBuffers.push({ sourcePath, buffer });
		}

		// The audio codec plan is decided on the main thread (where the audio
		// pipeline lives) by probing the preloaded source once.
		const audioPlan = await probeAudioCodec(config, source);
		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const platform = await getPlatformCached();

		const { onProgress, ...configPayload } = config;
		const runMessage: WorkerRunMessage = {
			type: "run",
			config: configPayload,
			sourceBuffer: source,
			...(webcam ? { webcamBuffer: webcam } : {}),
			...(regionBuffers.length ? { regionBuffers } : {}),
			wasmUrl,
			platform,
			...(audioPlan ? { audioCodec: audioPlan.codec } : {}),
		};

		return await new Promise<ExportResult>((resolve, reject) => {
			const worker = new Worker(new URL("./exportWorker.ts", import.meta.url), {
				type: "module",
			});
			this.worker = worker;

			const transfer: ArrayBuffer[] = [runMessage.sourceBuffer];
			if (runMessage.webcamBuffer) transfer.push(runMessage.webcamBuffer);
			for (const region of runMessage.regionBuffers ?? []) transfer.push(region.buffer);
			worker.postMessage(runMessage, transfer);

			worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
				const message = event.data;
				if (!message || typeof message !== "object") return;
				switch (message.type) {
					case "progress":
						config.onProgress?.(message.progress);
						break;
					case "done":
						worker.terminate();
						this.worker = null;
						resolve(message.result);
						break;
					case "error":
						worker.terminate();
						this.worker = null;
						reject(new Error(message.message));
						break;
				}
			};
			worker.onerror = (event) => {
				worker.terminate();
				this.worker = null;
				reject(new Error(event.message || "The export worker crashed."));
			};

			if (audioPlan) {
				void this.streamAudio(config, audioPlan);
			}
		});
	}

	/**
	 * Mirrors the in-page audio branch: the mixed/added-tracks path renders the
	 * whole timeline, the plain path decodes through a dedicated demuxer. The
	 * muxer is a proxy that forwards encoded chunks into the worker.
	 */
	private async streamAudio(
		config: VideoExporterConfig,
		plan: { codec: ExportAudioCodec; durationSec: number },
	) {
		const worker = this.worker;
		if (!worker) return;
		const proxyMuxer = {
			addAudioChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				const data = new ArrayBuffer(chunk.byteLength);
				chunk.copyTo(new Uint8Array(data));
				worker.postMessage(
					{
						type: "audio-chunk",
						chunk: { type: chunk.type, timestamp: chunk.timestamp, data },
						...(meta ? { meta } : {}),
					} satisfies WorkerInboundMessage,
					[data],
				);
			},
		};
		this.audioProcessor = new AudioProcessor();
		try {
			const hasExternalAudio = Boolean(config.audioRegions?.length);
			if (hasExternalAudio || config.blankSlideRegions?.length) {
				await this.audioProcessor.processMixed(
					config.videoUrl,
					true,
					(config.audioRegions ?? []) as ExternalAudioTrack[],
					proxyMuxer,
					config.trimRegions,
					config.speedRegions,
					plan.durationSec,
					plan.codec,
					config.blankSlideRegions,
				);
			} else {
				const demuxer = await StreamingVideoDecoder.loadDemuxer(config.videoUrl);
				try {
					await this.audioProcessor.process(
						demuxer,
						proxyMuxer,
						config.videoUrl,
						config.trimRegions,
						config.speedRegions,
						plan.durationSec,
						plan.codec,
					);
				} finally {
					demuxer.destroy();
				}
			}
			if (this.cancelled) return;
			worker.postMessage({ type: "audio-complete" } satisfies WorkerInboundMessage);
		} catch (error) {
			worker.postMessage({
				type: "audio-error",
				message: error instanceof Error ? error.message : String(error),
			} satisfies WorkerInboundMessage);
		}
	}
}

async function preloadArrayBuffer(url: string): Promise<ArrayBuffer | null> {
	const isRemoteUrl = /^(https?:|blob:|data:)/i.test(url);
	if (!isRemoteUrl && window.electronAPI?.readBinaryFile) {
		const result = await window.electronAPI.readBinaryFile(url);
		if (!result.success || !result.data) {
			console.warn("[VideoExporter] Worker preload failed:", result.message || result.error);
			return null;
		}
		return result.data;
	}
	try {
		const response = await fetch(url);
		if (!response.ok) return null;
		return await response.arrayBuffer();
	} catch {
		return null;
	}
}

async function probeAudioCodec(
	config: VideoExporterConfig,
	source: ArrayBuffer,
): Promise<{ codec: ExportAudioCodec; durationSec: number } | null> {
	const probe = new StreamingVideoDecoder();
	try {
		const info = await probe.loadMetadata(config.videoUrl, { blob: new Blob([source]) });
		const durationSec = Number.isFinite(info.duration) ? info.duration : 0;
		if (config.audioRegions?.length) {
			const codec = await AudioProcessor.selectSupportedExportCodec(48_000, 2);
			return codec ? { codec, durationSec } : null;
		}
		if (!info.hasAudio) return null;
		const demuxer = probe.getDemuxer();
		if (!demuxer) return null;
		const codec = await AudioProcessor.selectSupportedExportCodecForSource(demuxer);
		return codec ? { codec, durationSec } : null;
	} catch {
		return null;
	} finally {
		probe.destroy();
	}
}

let cachedPlatform: string | null = null;
async function getPlatformCached(): Promise<string> {
	if (cachedPlatform) return cachedPlatform;
	if (typeof navigator !== "undefined") {
		if (/Mac|iPhone|iPad|iPod/.test(navigator.platform)) cachedPlatform = "darwin";
		else if (/Linux/.test(navigator.platform)) cachedPlatform = "linux";
		else cachedPlatform = "win32";
	} else {
		cachedPlatform = "win32";
	}
	return cachedPlatform;
}
