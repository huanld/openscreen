import type { ExportAudioCodec } from "./audioEncoder";
import type { ExportProgress, ExportResult } from "./types";
import type { VideoExporterConfig } from "./videoExporter";

/** Serialized EncodedAudioChunk sent from the main thread into the worker. */
export interface SerializedAudioChunk {
	type: EncodedAudioChunkType;
	timestamp: number;
	data: ArrayBuffer;
}

export interface WorkerRunMessage {
	type: "run";
	/** VideoExporterConfig without callbacks; blobs arrive separately. */
	config: WorkerConfigPayload;
	sourceBuffer: ArrayBuffer;
	webcamBuffer?: ArrayBuffer;
	regionBuffers?: { sourcePath: string; buffer: ArrayBuffer }[];
	wasmUrl: string;
	platform: string;
	audioCodec?: ExportAudioCodec;
}

/**
 * VideoExporterConfig minus the fields that must not cross the worker
 * boundary (callbacks, preloaded blobs) — the worker reconstructs those.
 */
export type WorkerConfigPayload = Omit<
	VideoExporterConfig,
	| "onProgress"
	| "sourceBlob"
	| "webcamBlob"
	| "videoRegionBlobs"
	| "externalAudio"
	| "disableWorkerExport"
>;

export type WorkerInboundMessage =
	| WorkerRunMessage
	| { type: "audio-chunk"; chunk: SerializedAudioChunk; meta?: EncodedAudioChunkMetadata }
	| { type: "audio-complete" }
	| { type: "audio-error"; message: string }
	| { type: "cancel" };

export type WorkerOutboundMessage =
	| { type: "progress"; progress: ExportProgress }
	| { type: "done"; result: ExportResult }
	| { type: "error"; message: string };
