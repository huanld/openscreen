import type { BlankSlideRegion, VideoRegion } from "@/components/video-editor/types";
import { clipContentTimeMs, clipEndWithSlides } from "../slideAwareMediaClip";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { TimestampedVideoFrameQueue } from "./timestampedVideoFrameQueue";

interface RegionDecodeState {
	region: VideoRegion;
	decoder: StreamingVideoDecoder;
	queue: TimestampedVideoFrameQueue;
	sourceDurationMs: number;
	promise: Promise<void> | null;
}

const MAX_QUEUED_FRAMES_PER_REGION = 4;

export class VideoRegionFrameProvider {
	private states: RegionDecodeState[] = [];
	private stopped = false;

	async initialize(regions: readonly VideoRegion[]) {
		this.destroy();
		this.stopped = false;
		const states: RegionDecodeState[] = [];
		try {
			for (const region of regions) {
				const decoder = new StreamingVideoDecoder();
				let metadata: Awaited<ReturnType<StreamingVideoDecoder["loadMetadata"]>>;
				try {
					metadata = await decoder.loadMetadata(region.sourcePath);
				} catch (error) {
					decoder.destroy();
					throw error;
				}
				const metadataDurationMs = metadata.duration * 1000;
				states.push({
					region,
					decoder,
					queue: new TimestampedVideoFrameQueue(),
					sourceDurationMs:
						Number.isFinite(metadataDurationMs) && metadataDurationMs > 0
							? metadataDurationMs
							: Math.max(1, region.sourceDurationMs),
					promise: null,
				});
			}
			this.states = states;
		} catch (error) {
			for (const state of states) state.decoder.destroy();
			throw error;
		}
	}

	start(frameRate: number, onWarning?: (message: string) => void) {
		for (const state of this.states) {
			if (state.promise) continue;
			state.promise = state.decoder
				.decodeAll(
					frameRate,
					undefined,
					undefined,
					async (frame, _exportTimestampUs, sourceTimestampMs) => {
						while (state.queue.length >= MAX_QUEUED_FRAMES_PER_REGION && !this.stopped) {
							await new Promise((resolve) => setTimeout(resolve, 2));
						}
						if (this.stopped) {
							frame.close();
							return;
						}
						state.queue.enqueue(frame, sourceTimestampMs);
					},
					onWarning,
				)
				.then(() => state.queue.close())
				.catch((error) => {
					if (!this.stopped) {
						state.queue.fail(error instanceof Error ? error : new Error(String(error)));
					}
				});
		}
	}

	async framesAt(
		timelineTimeMs: number,
		slides?: BlankSlideRegion[],
	): Promise<Map<string, VideoFrame>> {
		const frames = new Map<string, VideoFrame>();
		for (const state of this.states) {
			const { region } = state;
			if (timelineTimeMs < region.startMs || timelineTimeMs >= clipEndWithSlides(region, slides))
				continue;
			const localTimeMs = Math.max(
				0,
				Math.min(
					(region.sourceStartMs ?? 0) +
						clipContentTimeMs(region, timelineTimeMs, slides) -
						region.startMs,
					state.sourceDurationMs - 0.5,
				),
			);
			const frame = await state.queue.frameAt(localTimeMs);
			if (frame) frames.set(region.id, frame);
		}
		return frames;
	}

	async stop() {
		this.stopped = true;
		for (const state of this.states) {
			state.queue.destroy();
			state.decoder.cancel();
		}
		await Promise.all(this.states.map((state) => state.promise?.catch(() => undefined)));
	}

	destroy() {
		this.stopped = true;
		for (const state of this.states) {
			state.queue.destroy();
			state.decoder.destroy();
		}
		this.states = [];
	}
}
