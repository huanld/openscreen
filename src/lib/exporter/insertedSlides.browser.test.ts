import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { BlankSlideRegion } from "@/components/video-editor/types";
import { createInsertedSlidePlayback } from "@/components/video-editor/videoPlayback/insertedSlidePlayback";
import fixtureUrl from "../../../tests/fixtures/clip-colors-and-tone.webm?url";
import { AudioProcessor } from "./audioEncoder";
import { GifExporter } from "./gifExporter";
import { decodeWithInsertedSlides, slideExportMetrics } from "./insertedSlideDecoder";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { VideoExporter } from "./videoExporter";
import { VideoRegionFrameProvider } from "./videoRegionFrameProvider";

const url = new URL(fixtureUrl, window.location.origin).href;
const slides: BlankSlideRegion[] = [
	{
		id: "slide",
		startMs: 500,
		endMs: 1500,
		backgroundColor: "#ffffff",
		transitionIn: "none",
		transitionOut: "none",
	},
];
const config = {
	videoUrl: url,
	width: 160,
	height: 90,
	frameRate: 15 as const,
	bitrate: 1_000_000,
	wallpaper: "#000000",
	zoomRegions: [],
	blankSlideRegions: slides,
	showShadow: false,
	shadowIntensity: 0,
	showBlur: false,
	padding: 0,
	borderRadius: 0,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
};

async function gesture() {
	const button = document.createElement("button");
	button.textContent = "Start slide playback test";
	document.body.append(button);
	await userEvent.click(button);
	button.remove();
}

function pixel(frame: CanvasImageSource) {
	const canvas = document.createElement("canvas");
	canvas.width = 160;
	canvas.height = 90;
	const context = canvas.getContext("2d")!;
	context.drawImage(frame, 0, 0, 160, 90);
	return [...context.getImageData(80, 45, 1, 1).data].slice(0, 3);
}

function expectColor(rgb: number[], color: "red" | "green" | "blue" | "white") {
	if (color === "white") {
		for (const channel of rgb) expect(channel).toBeGreaterThan(220);
		return;
	}
	const selected = { red: 0, green: 1, blue: 2 }[color];
	rgb.forEach((channel, index) =>
		index === selected ? expect(channel).toBeGreaterThan(190) : expect(channel).toBeLessThan(45),
	);
}

describe("inserted slides with real media", () => {
	it("retains real frames through introductory, adjacent and final slides", async () => {
		const bookends: BlankSlideRegion[] = [
			{ ...slides[0], id: "intro", startMs: 0, endMs: 500 },
			{ ...slides[0], id: "middle", startMs: 1500, endMs: 2000 },
			{ ...slides[0], id: "adjacent", startMs: 2000, endMs: 2500 },
			{ ...slides[0], id: "outro", startMs: 4500, endMs: 5000 },
		];
		const decoder = new StreamingVideoDecoder();
		try {
			const metadata = await decoder.loadMetadata(url);
			const metrics = slideExportMetrics(decoder, metadata.duration, 10, [], [], bookends);
			let count = 0;
			const checkpoints = [
				[200, "red"],
				[1200, "red"],
				[1800, "green"],
				[2300, "green"],
				[3200, "green"],
				[4800, "blue"],
			] as const;
			let index = 0;
			await decodeWithInsertedSlides(
				decoder,
				metadata.duration,
				10,
				[],
				[],
				bookends,
				async (frame, _output, timeMs) => {
					try {
						count++;
						if (index < checkpoints.length && timeMs >= checkpoints[index][0]) {
							expectColor(pixel(frame), checkpoints[index][1]);
							index++;
						}
					} finally {
						frame.close();
					}
				},
			);
			expect(count).toBe(metrics.totalFrames);
			expect(index).toBe(checkpoints.length);
		} finally {
			decoder.destroy();
		}
	});

	it("keeps the entire inserted video clip after pausing it during a slide", async () => {
		const provider = new VideoRegionFrameProvider();
		await provider.initialize([
			{
				id: "clip",
				name: "Clip",
				sourcePath: url,
				sourceDurationMs: 3000,
				startMs: 0,
				endMs: 3000,
				position: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				zIndex: 1,
			},
		]);
		provider.start(10);
		try {
			for (const [timeMs, color] of [
				[1000, "red"],
				[1700, "red"],
				[2600, "green"],
				[3600, "blue"],
			] as const) {
				const frames = await provider.framesAt(timeMs, slides);
				const frame = frames.get("clip")!;
				expect(frame).toBeDefined();
				try {
					expectColor(pixel(frame), color);
				} finally {
					frame.close();
				}
			}
		} finally {
			await provider.stop();
			provider.destroy();
		}
	});
	it("keeps a real paused video still when seeking, pausing and resuming inside the slide", async () => {
		await gesture();
		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		await new Promise<void>((resolve) => {
			video.onloadedmetadata = () => resolve();
			video.load();
		});
		const time = { current: 0 };
		const playing = { current: false };
		const controller = createInsertedSlidePlayback({
			video,
			currentTimeRef: time,
			isPlayingRef: playing,
			allowPlaybackRef: { current: false },
			blankSlideRegionsRef: { current: slides },
			trimRegionsRef: { current: [] },
			speedRegionsRef: { current: [] },
			isSeekingRef: { current: false },
			onTimeUpdate: () => undefined,
			onPlayStateChange: () => undefined,
		});
		try {
			controller.seek(0.7);
			await controller.play();
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(video.paused).toBe(true);
			expect(video.currentTime).toBeCloseTo(0.5, 2);
			expect(time.current).toBeGreaterThan(800);
			controller.pause();
			const stopped = time.current;
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(time.current).toBe(stopped);
			controller.seek(1.4);
			await controller.play();
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(time.current).toBeGreaterThan(1500);
			expect(video.currentTime).toBeGreaterThan(0.5);
			expect(video.currentTime).toBeLessThan(0.85);
		} finally {
			controller.pause();
			controller.destroy();
			video.src = "";
			video.load();
		}
	});

	it("exports MP4 with a whole second of slide and the entire resumed clip", async () => {
		await gesture();
		const result = await new VideoExporter({ ...config, webcamVideoUrl: url }).export();
		expect(result.success, result.error).toBe(true);
		const outputUrl = URL.createObjectURL(result.blob!);
		const decoder = new StreamingVideoDecoder();
		try {
			const metadata = await decoder.loadMetadata(outputUrl);
			expect(metadata.duration).toBeGreaterThanOrEqual(4);
			expect(metadata.duration).toBeLessThan(4.1);
			const checkpoints = [
				[200, "red"],
				[800, "white"],
				[1300, "white"],
				[1700, "red"],
				[2600, "green"],
				[3600, "blue"],
			] as const;
			let index = 0;
			await decoder.decodeAll(15, [], [], async (frame, _export, timeMs) => {
				try {
					if (index < checkpoints.length && timeMs >= checkpoints[index][0]) {
						expectColor(pixel(frame), checkpoints[index][1]);
						index++;
					}
				} finally {
					frame.close();
				}
			});
			expect(index).toBe(checkpoints.length);
		} finally {
			decoder.destroy();
			URL.revokeObjectURL(outputUrl);
		}
	});

	it("exports GIF on the same clock, with red resuming after the white slide", async () => {
		const result = await new GifExporter({
			...config,
			loop: false,
			sizePreset: "original",
		}).export();
		expect(result.success, result.error).toBe(true);
		const Decoder = (
			globalThis as unknown as {
				ImageDecoder: new (options: {
					data: ArrayBuffer;
					type: string;
				}) => {
					tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
					decode: (options: { frameIndex: number }) => Promise<{ image: VideoFrame }>;
					close: () => void;
				};
			}
		).ImageDecoder;
		const decoder = new Decoder({ data: await result.blob!.arrayBuffer(), type: "image/gif" });
		try {
			await decoder.tracks.ready;
			// The fixture's container includes an 8 ms audio tail: one final CFR frame.
			expect(decoder.tracks.selectedTrack.frameCount).toBe(61);
			for (const [index, color] of [
				[12, "white"],
				[25, "red"],
				[39, "green"],
				[54, "blue"],
			] as const) {
				const { image } = await decoder.decode({ frameIndex: index });
				try {
					expectColor(pixel(image), color);
				} finally {
					image.close();
				}
			}
		} finally {
			decoder.close();
		}
	});

	it("exports silence during the slide, then the same source tone and final audio tail", async () => {
		await gesture();
		const processor = new AudioProcessor() as unknown as {
			renderMixedTimelineAudio: (
				url: string,
				source: boolean,
				tracks: [],
				trims: [],
				speeds: [],
				duration: number,
				slides: BlankSlideRegion[],
			) => Promise<Blob>;
		};
		const blob = await processor.renderMixedTimelineAudio(url, true, [], [], [], 3, slides);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(await blob.arrayBuffer());
			expect(audio.duration).toBeGreaterThan(3.9);
			expect(audio.duration).toBeLessThan(4.3);
			const data = audio.getChannelData(0);
			const rate = audio.sampleRate;
			const rms = (start: number, end: number) => {
				const samples = data.slice(Math.round(start * rate), Math.round(end * rate));
				return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
			};
			expect(rms(0.1, 0.3)).toBeGreaterThan(0.04);
			expect(rms(0.8, 1.2)).toBeLessThan(0.003);
			expect(rms(3.6, 3.85)).toBeGreaterThan(0.04);
			const frequency = (start: number, end: number) => {
				let count = 0;
				for (let i = Math.round(start * rate); i < Math.round(end * rate); i++)
					if (data[i] <= 0 && data[i + 1] > 0) count++;
				return count / (end - start);
			};
			expect(frequency(1.65, 1.85)).toBeGreaterThan(190);
			expect(frequency(1.65, 1.85)).toBeLessThan(260);
			expect(frequency(2.3, 2.6)).toBeGreaterThan(820);
			expect(frequency(2.3, 2.6)).toBeLessThan(940);
		} finally {
			await context.close();
		}
	});
});
