import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import fixtureUrl from "../../../tests/fixtures/clip-colors-and-tone.webm?url";
import { splitMediaClip } from "../mediaClipTiming";
import { AudioProcessor, type ExternalAudioTrack } from "./audioEncoder";
import { VideoRegionFrameProvider } from "./videoRegionFrameProvider";

const sourceUrl = new URL(fixtureUrl, window.location.origin).href;

describe("trimmed media export with real codecs", () => {
	it("decodes green then blue after source trim and split, rather than restarting red", async () => {
		const clip = {
			id: "left",
			startMs: 0,
			endMs: 2000,
			sourceStartMs: 1000,
			sourcePath: sourceUrl,
			sourceDurationMs: 3000,
			name: "Fixture",
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			zIndex: 1,
		};
		const parts = splitMediaClip(clip, 1000, "right")!;
		const provider = new VideoRegionFrameProvider();
		await provider.initialize(parts);
		provider.start(10);
		try {
			const canvas = document.createElement("canvas");
			canvas.width = 160;
			canvas.height = 90;
			const ctx = canvas.getContext("2d")!;
			for (const [time, id, expectedChannel] of [
				[500, "left", 1],
				[1500, "right", 2],
			] as const) {
				const frames = await provider.framesAt(time);
				const frame = frames.get(id)!;
				expect(frame).toBeDefined();
				ctx.drawImage(frame, 0, 0);
				frame.close();
				const pixel = ctx.getImageData(80, 45, 1, 1).data;
				expect(pixel[expectedChannel]).toBeGreaterThan(200);
				expect(pixel[0]).toBeLessThan(30);
			}
		} finally {
			await provider.stop();
			provider.destroy();
		}
	});

	it("exports the selected source sound at the requested volume with both fades", async () => {
		// Match the real export button's trusted gesture for browser audio policy.
		const button = document.createElement("button");
		button.textContent = "Start media export test";
		document.body.append(button);
		await userEvent.click(button);
		button.remove();
		const processor = new AudioProcessor();
		const render = processor as unknown as {
			renderMixedTimelineAudio: (
				url: string,
				sourceAudio: boolean,
				tracks: ExternalAudioTrack[],
				trims: [],
				speeds: [],
				duration: number,
			) => Promise<Blob>;
		};
		const blob = await render.renderMixedTimelineAudio(
			sourceUrl,
			false,
			[
				{
					id: "music",
					startMs: 0,
					endMs: 2000,
					sourceUrl,
					sourceStartMs: 1000,
					volume: 0.5,
					fadeInMs: 500,
					fadeOutMs: 500,
				},
			],
			[],
			[],
			2,
		);
		expect(blob.size).toBeGreaterThan(1000);
		const context = new AudioContext();
		try {
			const buffer = await context.decodeAudioData(await blob.arrayBuffer());
			const samples = buffer.getChannelData(0);
			const rate = buffer.sampleRate;
			const energy = (start: number, end: number) => {
				const section = samples.slice(Math.round(start * rate), Math.round(end * rate));
				return Math.sqrt(section.reduce((sum, value) => sum + value * value, 0) / section.length);
			};
			const middle = energy(0.8, 1.2);
			expect(middle).toBeGreaterThan(0.03);
			expect(middle).toBeLessThan(0.06);
			expect(energy(0.03, 0.1)).toBeLessThan(middle * 0.5);
			expect(energy(1.85, 1.94)).toBeLessThan(middle * 0.5);
			let crossings = 0;
			for (let i = Math.round(0.8 * rate); i < Math.round(1.2 * rate); i++) {
				if (samples[i] <= 0 && samples[i + 1] > 0) crossings++;
			}
			expect(crossings / 0.4).toBeGreaterThan(800);
			expect(crossings / 0.4).toBeLessThan(950);
		} finally {
			await context.close();
		}
	});
});
