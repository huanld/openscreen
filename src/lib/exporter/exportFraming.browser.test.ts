import { afterEach, describe, expect, it } from "vitest";
import { applyVideoOnlyFraming, type FramingStyle } from "./exportFraming";
import { FrameRenderer } from "./frameRenderer";

const WIDTH = 320;
const HEIGHT = 180;
const VIDEO_GREEN = [0, 200, 0] as const;
const VIDEO_BLUE = [0, 80, 255] as const;
const WALLPAPER_MAGENTA = [255, 0, 255] as const;

const editorStyle: FramingStyle = {
	wallpaper: "#ff00ff",
	padding: 40,
	borderRadius: 16,
	shadowIntensity: 0.6,
	showBlur: true,
	webcamLayoutPreset: "picture-in-picture",
};

const renderers: FrameRenderer[] = [];
afterEach(() => {
	for (const renderer of renderers.splice(0)) renderer.destroy();
});

function solidVideoFrame(timestamp = 0, colour: readonly number[] = VIDEO_GREEN) {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable.");
	context.fillStyle = `rgb(${colour.join(",")})`;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	return new VideoFrame(canvas, { timestamp });
}

async function renderOneFrame(style: FramingStyle) {
	const renderer = new FrameRenderer({
		width: WIDTH,
		height: HEIGHT,
		wallpaper: style.wallpaper,
		zoomRegions: [],
		// Shadow is left out of the composed case so the corner pixels are pure
		// wallpaper; the video-only case must strip it regardless.
		showShadow: false,
		shadowIntensity: 0,
		showBlur: style.showBlur,
		borderRadius: style.borderRadius,
		padding: style.padding,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		videoWidth: WIDTH,
		videoHeight: HEIGHT,
		webcamLayoutPreset: style.webcamLayoutPreset,
		platform: "win32",
	});
	renderers.push(renderer);
	await renderer.initialize();
	const frame = solidVideoFrame();
	try {
		await renderer.renderFrame(frame, 0, null);
	} finally {
		frame.close();
	}
	const context = renderer.getCanvas().getContext("2d");
	if (!context) throw new Error("The renderer canvas has no 2D context.");
	return (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
}

function expectColour(actual: number[], expected: readonly number[]) {
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(12);
	}
}

// A few pixels in from each edge, so antialiasing on the frame border is excluded.
const CORNERS = [
	[3, 3],
	[WIDTH - 4, 3],
	[3, HEIGHT - 4],
	[WIDTH - 4, HEIGHT - 4],
] as const;

describe("video-only export framing (real renderer)", () => {
	it("shows the wallpaper around the recording in the editor's framing", async () => {
		const pixel = await renderOneFrame({ ...editorStyle, showBlur: false });
		for (const [x, y] of CORNERS) expectColour(pixel(x, y), WALLPAPER_MAGENTA);
		expectColour(pixel(WIDTH / 2, HEIGHT / 2), VIDEO_GREEN);
	});

	it("fills the whole frame with the recording and nothing else when exporting video only", async () => {
		const pixel = await renderOneFrame(applyVideoOnlyFraming(editorStyle));
		for (const [x, y] of CORNERS) expectColour(pixel(x, y), VIDEO_GREEN);
		expectColour(pixel(WIDTH / 2, HEIGHT / 2), VIDEO_GREEN);
	});

	it("reuses the cached shadow ring across frames while the recording content keeps updating", async () => {
		// The shadow ring and blurred wallpaper are cached once the camera transform
		// holds still; the live video must still refresh every frame underneath them.
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#ff00ff",
			zoomRegions: [],
			showShadow: true,
			shadowIntensity: 0.6,
			showBlur: true,
			borderRadius: 16,
			padding: 40,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			platform: "win32",
		});
		renderers.push(renderer);
		await renderer.initialize();
		const context = renderer.getCanvas().getContext("2d");
		if (!context) throw new Error("The renderer canvas has no 2D context.");
		const pixel = (x: number, y: number) =>
			Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));

		const greenFrame = solidVideoFrame(0);
		try {
			await renderer.renderFrame(greenFrame, 0, null);
		} finally {
			greenFrame.close();
		}
		expectColour(pixel(WIDTH / 2, HEIGHT / 2), VIDEO_GREEN);

		// The card edge sits ~25px in (padding scales with the preview fit); the shadow
		// ring is the darkening gradient outside it. Adjacent-to-edge must be darker
		// than farther out for the shadow to be present.
		const ringLuminance = (p: number[]) => p[0] + p[1] + p[2];
		expect(ringLuminance(pixel(24, HEIGHT / 2))).toBeLessThan(ringLuminance(pixel(4, HEIGHT / 2)));
		const ringFrame1 = pixel(14, HEIGHT / 2);

		// Second frame, same transform, different content: the card must show the new
		// colour while the cached ring around it stays identical.
		const blueFrame = solidVideoFrame(16_666, VIDEO_BLUE);
		try {
			await renderer.renderFrame(blueFrame, 16_666_000, null);
		} finally {
			blueFrame.close();
		}
		expectColour(pixel(WIDTH / 2, HEIGHT / 2), VIDEO_BLUE);
		const ringFrame2 = pixel(14, HEIGHT / 2);
		for (let channel = 0; channel < 3; channel++) {
			expect(Math.abs(ringFrame2[channel] - ringFrame1[channel])).toBeLessThanOrEqual(3);
		}

		// Changing the card geometry (transform keyframes drive the applied scale) must
		// invalidate the cache and move the shadow ring.
		const scaledRenderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#ff00ff",
			zoomRegions: [],
			showShadow: true,
			shadowIntensity: 0.6,
			showBlur: true,
			borderRadius: 16,
			padding: 40,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			videoTransformKeyframes: [
				{ id: "small", timeMs: 0, position: null, scale: 0.5 },
				{ id: "full", timeMs: 1000, position: null, scale: 1.25 },
			],
			platform: "win32",
		});
		renderers.push(scaledRenderer);
		await scaledRenderer.initialize();
		const scaledContext = scaledRenderer.getCanvas().getContext("2d");
		if (!scaledContext) throw new Error("The renderer canvas has no 2D context.");
		const scaledPixel = (x: number, y: number) =>
			Array.from(scaledContext.getImageData(x, y, 1, 1).data.slice(0, 3));
		for (const [timestampUs, expectCard] of [
			[0, false],
			[1_000_000, true],
		] as const) {
			const frame = solidVideoFrame(timestampUs / 1000);
			try {
				await scaledRenderer.renderFrame(frame, timestampUs, null);
			} finally {
				frame.close();
			}
			// At scale 0.5 the card leaves (100, 10) as wallpaper; at 1.25 it covers it.
			expectColour(scaledPixel(100, 10), expectCard ? VIDEO_GREEN : WALLPAPER_MAGENTA);
		}
	});

	it("applies main-video size keyframes during export", async () => {
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#ff00ff",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			padding: 50,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			videoTransformKeyframes: [
				{ id: "small", timeMs: 0, position: null, scale: 0.5 },
				{ id: "full", timeMs: 1000, position: null, scale: 1.25 },
			],
			platform: "win32",
		});
		renderers.push(renderer);
		await renderer.initialize();

		const smallFrame = solidVideoFrame();
		try {
			await renderer.renderFrame(smallFrame, 0, null);
		} finally {
			smallFrame.close();
		}
		const context = renderer.getCanvas().getContext("2d");
		if (!context) throw new Error("The renderer canvas has no 2D context.");
		expectColour(Array.from(context.getImageData(3, 3, 1, 1).data.slice(0, 3)), WALLPAPER_MAGENTA);

		const fullFrame = solidVideoFrame();
		try {
			await renderer.renderFrame(fullFrame, 1_000_000, null);
		} finally {
			fullFrame.close();
		}
		expectColour(Array.from(context.getImageData(3, 3, 1, 1).data.slice(0, 3)), VIDEO_GREEN);
	});

	it("renders added video components at their saved canvas position", async () => {
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#000000",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			platform: "win32",
			videoRegions: [
				{
					id: "video-component-1",
					startMs: 0,
					endMs: 1000,
					sourcePath: "component.mp4",
					name: "component.mp4",
					sourceDurationMs: 1000,
					position: { x: 25, y: 25 },
					size: { width: 50, height: 50 },
					fitMode: "cover",
					cropPosition: { x: 50, y: 50 },
					zIndex: 1,
				},
			],
		});
		renderers.push(renderer);
		await renderer.initialize();

		const mainFrame = solidVideoFrame();
		const componentCanvas = new OffscreenCanvas(90, 160);
		const componentContext = componentCanvas.getContext("2d");
		if (!componentContext) throw new Error("Canvas is unavailable.");
		componentContext.fillStyle = "rgb(220, 20, 20)";
		componentContext.fillRect(0, 0, 160, 90);
		const componentFrame = new VideoFrame(componentCanvas, { timestamp: 0 });

		try {
			await renderer.renderFrame(
				mainFrame,
				0,
				null,
				new Map([["video-component-1", componentFrame]]),
			);
		} finally {
			mainFrame.close();
			componentFrame.close();
		}

		const context = renderer.getCanvas().getContext("2d");
		if (!context) throw new Error("The renderer canvas has no 2D context.");
		expectColour(
			Array.from(context.getImageData(WIDTH / 2, HEIGHT / 2, 1, 1).data.slice(0, 3)),
			[220, 20, 20],
		);
		expectColour(
			Array.from(context.getImageData(WIDTH / 4 + 3, HEIGHT / 2, 1, 1).data.slice(0, 3)),
			[220, 20, 20],
		);
		expectColour(
			Array.from(context.getImageData((WIDTH * 3) / 4 - 3, HEIGHT / 2, 1, 1).data.slice(0, 3)),
			[220, 20, 20],
		);
		expectColour(Array.from(context.getImageData(10, 10, 1, 1).data.slice(0, 3)), VIDEO_GREEN);
	});

	it("renders only the wallpaper during a blank slide interval", async () => {
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#ff00ff",
			zoomRegions: [],
			blankSlideRegions: [{ id: "blank-slide-1", startMs: 0, endMs: 1000 }],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			platform: "win32",
		});
		renderers.push(renderer);
		await renderer.initialize();
		const frame = solidVideoFrame();
		try {
			await renderer.renderFrame(frame, 0, null);
		} finally {
			frame.close();
		}

		const context = renderer.getCanvas().getContext("2d");
		if (!context) throw new Error("The renderer canvas has no 2D context.");
		expectColour(
			Array.from(context.getImageData(WIDTH / 2, HEIGHT / 2, 1, 1).data.slice(0, 3)),
			WALLPAPER_MAGENTA,
		);
	});

	it("renders presentation slide fade transitions over the recorded video", async () => {
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#ff00ff",
			zoomRegions: [],
			blankSlideRegions: [
				{
					id: "blank-slide-1",
					startMs: 0,
					endMs: 1200,
					backgroundColor: "#ffffff",
					transitionIn: "fade",
					transitionOut: "fade",
					transitionDurationMs: 400,
				},
			],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			platform: "win32",
		});
		renderers.push(renderer);
		await renderer.initialize();

		const renderAt = async (timeMs: number) => {
			const frame = solidVideoFrame(timeMs * 1000);
			try {
				await renderer.renderFrame(frame, timeMs * 1000, null);
			} finally {
				frame.close();
			}
			const context = renderer.getCanvas().getContext("2d");
			if (!context) throw new Error("The renderer canvas has no 2D context.");
			return Array.from(context.getImageData(WIDTH / 2, HEIGHT / 2, 1, 1).data.slice(0, 3));
		};

		expectColour(await renderAt(0), VIDEO_GREEN);
		expectColour(await renderAt(200), [128, 228, 128], 4);
		expectColour(await renderAt(500), [255, 255, 255]);
		expectColour(await renderAt(1000), [128, 228, 128], 4);
	});

	it("keeps text on the full canvas when the main video is made smaller", async () => {
		const renderer = new FrameRenderer({
			width: WIDTH,
			height: HEIGHT,
			wallpaper: "#000000",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: WIDTH,
			videoHeight: HEIGHT,
			videoScale: 0.5,
			videoPosition: { cx: 0.75, cy: 0.5 },
			platform: "win32",
			annotationRegions: [
				{
					id: "text-1",
					startMs: 0,
					endMs: 1000,
					type: "text",
					content: "TEXT",
					position: { x: 0, y: 0 },
					size: { width: 25, height: 100 },
					style: {
						color: "#ff0000",
						backgroundColor: "transparent",
						fontSize: 40,
						fontFamily: "sans-serif",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
					},
					zIndex: 1,
				},
			],
		});
		renderers.push(renderer);
		await renderer.initialize();
		const frame = solidVideoFrame();
		try {
			await renderer.renderFrame(frame, 0, null);
		} finally {
			frame.close();
		}

		const context = renderer.getCanvas().getContext("2d");
		if (!context) throw new Error("The renderer canvas has no 2D context.");
		const pixels = context.getImageData(0, 0, 80, HEIGHT).data;
		let foundRedTextPixel = false;
		for (let index = 0; index < pixels.length; index += 4) {
			if (pixels[index] > 160 && pixels[index + 1] < 100 && pixels[index + 2] < 100) {
				foundRedTextPixel = true;
				break;
			}
		}
		expect(foundRedTextPixel).toBe(true);
	});
});
