import type { BlankSlideRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import {
	createInsertedTimelineSegments,
	insertedTimelineMetrics,
	insertedTimelineSamples,
} from "../insertedSlideTiming";
import type { StreamingVideoDecoder } from "./streamingDecoder";

export function slideExportMetrics(
	decoder: StreamingVideoDecoder,
	sourceDurationSec: number,
	frameRate: number,
	trims?: TrimRegion[],
	speeds?: SpeedRegion[],
	slides?: BlankSlideRegion[],
) {
	if (!slides?.length) return decoder.getExportMetrics(frameRate, trims, speeds);
	return insertedTimelineMetrics(
		createInsertedTimelineSegments(sourceDurationSec * 1000, slides, trims, speeds),
		frameRate,
	);
}

/** Resample a forward decode onto the presentation clock, retaining the frame during slides. */
export async function decodeWithInsertedSlides(
	decoder: StreamingVideoDecoder,
	sourceDurationSec: number,
	frameRate: number,
	trims: TrimRegion[] | undefined,
	speeds: SpeedRegion[] | undefined,
	slides: BlankSlideRegion[] | undefined,
	onFrame: (frame: VideoFrame, exportUs: number, timelineMs: number) => Promise<void>,
	onWarning?: (message: string) => void,
	isCancelled: () => boolean = () => false,
) {
	if (!slides?.length) return decoder.decodeAll(frameRate, trims, speeds, onFrame, onWarning);
	const samples = insertedTimelineSamples(
		createInsertedTimelineSegments(sourceDurationSec * 1000, slides, trims, speeds),
		frameRate,
	);
	let next = samples.next();
	let held: VideoFrame | null = null;
	let heldMs = 0;
	let index = 0;
	const emitUntil = async (boundaryMs: number) => {
		while (held && !next.done && next.value.sourceMs <= boundaryMs && !isCancelled()) {
			const clone = new VideoFrame(held);
			await onFrame(clone, (index++ * 1_000_000) / frameRate, next.value.timelineMs);
			next = samples.next();
		}
	};
	try {
		await decoder.decodeAll(
			frameRate,
			undefined,
			undefined,
			async (frame, _exportUs, sourceMs) => {
				try {
					if (isCancelled()) return;
					await emitUntil((heldMs + sourceMs) / 2);
					held?.close();
					held = new VideoFrame(frame);
					heldMs = sourceMs;
				} finally {
					frame.close();
				}
			},
			onWarning,
		);
		await emitUntil(Infinity);
	} finally {
		(held as VideoFrame | null)?.close();
	}
}
