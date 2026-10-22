import type { BlankSlideRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { createInsertedTimelineSegments, timelineToSourceMs } from "../insertedSlideTiming";
import { getMediaClipGain } from "../mediaClipTiming";
import { clipContentTimeMs, clipEndWithSlides } from "../slideAwareMediaClip";
import type { ExternalAudioTrack } from "./audioEncoder";

interface AudioRenderDependencies {
	waitForMetadata: (media: HTMLMediaElement) => Promise<void>;
	seek: (media: HTMLMediaElement, seconds: number) => Promise<void>;
	startRecording: (stream: MediaStream) => {
		recorder: MediaRecorder;
		recordedBlobPromise: Promise<Blob>;
	};
	isCancelled: () => boolean;
}

/** Record silence during slide holds, then resume every source from its saved in-point. */
export async function renderInsertedSlideAudio(
	url: string,
	hasSourceAudio: boolean,
	tracks: ExternalAudioTrack[],
	trims: TrimRegion[],
	speeds: SpeedRegion[],
	sourceDurationSec: number,
	slides: BlankSlideRegion[],
	deps: AudioRenderDependencies,
): Promise<Blob> {
	const clock = document.createElement("video");
	clock.src = url;
	clock.preload = "auto";
	clock.preservesPitch = true;
	const external = tracks.map((track) => {
		const media = document.createElement("audio");
		media.src = track.sourceUrl;
		media.preload = "auto";
		media.preservesPitch = true;
		return { track, media, gain: null as GainNode | null, pending: false };
	});
	let context: AudioContext | null = null;
	let destination: MediaStreamAudioDestinationNode | null = null;
	let recorder: MediaRecorder | null = null;
	let output: Promise<Blob> | null = null;
	let raf: number | null = null;
	const nodes: AudioNode[] = [];
	try {
		await Promise.all([
			deps.waitForMetadata(clock),
			...external.map(({ media }) => deps.waitForMetadata(media)),
		]);
		context = new AudioContext();
		if (context.state === "suspended") await context.resume();
		destination = context.createMediaStreamDestination();
		if (hasSourceAudio) {
			const node = context.createMediaElementSource(clock);
			node.connect(destination);
			nodes.push(node);
		}
		for (const state of external) {
			const source = context.createMediaElementSource(state.media);
			state.gain = context.createGain();
			state.gain.gain.value = 0;
			source.connect(state.gain);
			state.gain.connect(destination);
			nodes.push(source, state.gain);
		}
		const syncTracks = (timeMs: number, rate: number) => {
			for (const state of external) {
				const { media, track, gain } = state;
				const sourceMs =
					(track.sourceStartMs ?? 0) +
					timelineToSourceMs(timeMs, slides) -
					timelineToSourceMs(track.startMs, slides);
				const active =
					timeMs >= track.startMs &&
					timeMs < clipEndWithSlides(track, slides) &&
					sourceMs / 1000 < media.duration;
				gain!.gain.setTargetAtTime(
					active ? getMediaClipGain(track, clipContentTimeMs(track, timeMs, slides)) : 0,
					context!.currentTime,
					0.005,
				);
				if (!active) {
					media.pause();
					continue;
				}
				media.playbackRate = rate;
				if (Math.abs(media.currentTime * 1000 - sourceMs) > 80)
					media.currentTime = Math.max(0, sourceMs) / 1000;
				if (media.paused && !state.pending) {
					state.pending = true;
					void media
						.play()
						.catch(() => undefined)
						.finally(() => {
							state.pending = false;
						});
				}
			}
		};
		const segments = createInsertedTimelineSegments(
			sourceDurationSec * 1000,
			slides,
			trims,
			speeds,
		);
		for (const segment of segments) {
			if (deps.isCancelled()) throw new Error("Export cancelled");
			clock.pause();
			for (const { media, gain } of external) {
				media.pause();
				gain!.gain.setValueAtTime(0, context.currentTime);
			}
			if (recorder?.state === "recording") recorder.pause();
			if (Math.abs(clock.currentTime * 1000 - segment.sourceStartMs) > 2)
				await deps.seek(clock, segment.sourceStartMs / 1000);
			clock.playbackRate = segment.speed;
			if (!recorder) {
				const recording = deps.startRecording(destination.stream);
				recorder = recording.recorder;
				output = recording.recordedBlobPromise;
			} else if (recorder.state === "paused") recorder.resume();
			const held = segment.paused || segment.sourceEndMs <= segment.sourceStartMs;
			if (!held) {
				await clock.play();
				syncTracks(segment.startMs, segment.speed);
			}
			await new Promise<void>((resolve, reject) => {
				const started = performance.now();
				let previousSource = clock.currentTime;
				let lastProgress = started;
				const finish = (error?: Error) => {
					if (raf !== null) cancelAnimationFrame(raf);
					raf = null;
					clock.removeEventListener("error", onError);
					if (error) reject(error);
					else resolve();
				};
				const onError = () => finish(new Error("Unable to render audio across an inserted slide"));
				const tick = (now: number) => {
					if (deps.isCancelled()) {
						finish(new Error("Export cancelled"));
						return;
					}
					if (held) {
						if (now - started >= (segment.endMs - segment.startMs) / segment.speed) {
							finish();
							return;
						}
					} else {
						const sourceMs = clock.currentTime * 1000;
						if (sourceMs >= segment.sourceEndMs - 3 || clock.ended) {
							clock.pause();
							finish();
							return;
						}
						if (clock.currentTime > previousSource) {
							previousSource = clock.currentTime;
							lastProgress = now;
						}
						if (now - lastProgress > 10_000) {
							finish(new Error("Audio playback stalled during export"));
							return;
						}
						syncTracks(segment.startMs + sourceMs - segment.sourceStartMs, segment.speed);
					}
					raf = requestAnimationFrame(tick);
				};
				clock.addEventListener("error", onError, { once: true });
				raf = requestAnimationFrame(tick);
			});
		}
	} finally {
		if (raf !== null) cancelAnimationFrame(raf);
		clock.pause();
		for (const { media } of external) media.pause();
		if (recorder && recorder.state !== "inactive") recorder.stop();
		destination?.stream.getTracks().forEach((track) => track.stop());
		for (const node of nodes) node.disconnect();
		destination?.disconnect();
		if (context) await context.close();
		for (const media of [clock, ...external.map((state) => state.media)]) {
			media.src = "";
			media.load();
		}
	}
	return output ? await output : new Blob([], { type: "audio/webm" });
}
