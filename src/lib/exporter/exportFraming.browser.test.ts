import { afterEach, describe, expect, it } from "vitest";
import { applyVideoOnlyFraming, type FramingStyle } from "./exportFraming";
import { FrameRenderer } from "./frameRenderer";

const WIDTH = 320;
const HEIGHT = 180;
const VIDEO_GREEN = [0, 200, 0] as const;
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

function solidVideoFrame() {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable.");
	context.fillStyle = `rgb(${VIDEO_GREEN.join(",")})`;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	return new VideoFrame(canvas, { timestamp: 0 });
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
});
