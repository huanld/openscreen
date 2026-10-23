import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { regionToPixels, ScreenshotRegionSelection } from "./screenshotRegion";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), crop: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: mocks.decode } }));

function contents() {
	let destroyed = false;
	const emitter = Object.assign(new EventEmitter(), {
		isDestroyed: () => destroyed,
		destroy: () => {
			destroyed = true;
			emitter.emit("destroyed");
		},
	});
	return emitter;
}

function windowFixture() {
	let destroyed = false;
	const overlay = Object.assign(new EventEmitter(), {
		webContents: contents(),
		isDestroyed: () => destroyed,
		destroy: vi.fn(() => {
			destroyed = true;
			overlay.emit("closed");
		}),
	});
	return overlay;
}

function pngHeader(width: number, height: number) {
	const bytes = Buffer.alloc(24);
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

const image = {
	dataUrl: `data:image/png;base64,${pngHeader(3840, 2160).toString("base64")}`,
	width: 3840,
	height: 2160,
	name: "Display 1",
};

function selectionFixture() {
	const origin = contents();
	const window = windowFixture();
	const selection = new ScreenshotRegionSelection(
		[{ image, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }],
		origin as unknown as WebContents,
		() => window as unknown as BrowserWindow,
	);
	return { origin, window, selection, sender: window.webContents as unknown as WebContents };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocks.crop.mockImplementation((rect) => ({
		isEmpty: () => false,
		getSize: () => ({ width: rect.width, height: rect.height }),
		getScaleFactors: () => [1],
		toPNG: () => pngHeader(rect.width, rect.height),
	}));
	mocks.decode.mockReturnValue({
		isEmpty: () => false,
		getSize: () => ({ width: 3840, height: 2160 }),
		crop: mocks.crop,
	});
});
afterEach(() => {
	vi.useRealTimers();
});

describe("normalized screenshot region", () => {
	it("converts a desktop selection to physical high DPI pixels", () => {
		expect(regionToPixels({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 3840, 2160)).toEqual({
			x: 960,
			y: 540,
			width: 1920,
			height: 1080,
		});
	});
	it("rounds outward and clamps at the image edge", () => {
		expect(regionToPixels({ x: 0.333, y: 0.333, width: 0.667, height: 0.667 }, 100, 80)).toEqual({
			x: 33,
			y: 26,
			width: 67,
			height: 54,
		});
	});
	it.each([
		null,
		{},
		{ x: 0, y: 0, width: 0, height: 1 },
		{ x: -0.1, y: 0, width: 1, height: 1 },
		{ x: 0.5, y: 0, width: 0.6, height: 1 },
		{ x: 0, y: 0, width: Infinity, height: 1 },
		{ x: "0", y: 0, width: 1, height: 1 },
	])("rejects invalid or out-of-display coordinates: %j", (region) => {
		expect(() => regionToPixels(region, 3840, 2160)).toThrow();
	});
});

describe("screen selection lifetime", () => {
	it("only gives frozen pixels to the active overlay and crops in physical coordinates", async () => {
		const { selection, sender, origin, window } = selectionFixture();
		expect(() => selection.getImage(origin as unknown as WebContents)).toThrow(/cannot access/);
		expect(() => selection.complete(null, origin as unknown as WebContents)).toThrow(
			/cannot access/,
		);
		expect(selection.getImage(sender)).toBe(image);
		selection.complete({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, sender);
		await expect(selection.result).resolves.toMatchObject({ width: 1920, height: 1080 });
		expect(mocks.crop).toHaveBeenCalledWith({ x: 960, y: 540, width: 1920, height: 1080 });
		expect(window.destroy).toHaveBeenCalledOnce();
		expect(origin.listenerCount("destroyed")).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("crops retained native pixels instead of decoding the lightweight preview", async () => {
		const origin = contents();
		const window = windowFixture();
		const nativePixels = { crop: mocks.crop };
		const selection = new ScreenshotRegionSelection(
			[
				{
					image: { ...image, dataUrl: "data:image/jpeg;base64,/9j/2Q==" },
					nativeImage: nativePixels as unknown as import("electron").NativeImage,
					bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				},
			],
			origin as unknown as WebContents,
			() => window as unknown as BrowserWindow,
		);
		selection.complete(
			{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
			window.webContents as unknown as WebContents,
		);
		await expect(selection.result).resolves.toMatchObject({ width: 1920, height: 1080 });
		expect(mocks.crop).toHaveBeenCalledWith({ x: 960, y: 540, width: 1920, height: 1080 });
		expect(mocks.decode).not.toHaveBeenCalled();
	});
	it("activates prepared windows only when selection startup is explicit", () => {
		const origin = contents();
		const window = windowFixture();
		const activate = vi.fn();
		const create = vi.fn();
		const selection = new ScreenshotRegionSelection(
			[
				{
					image,
					bounds: { x: 0, y: 0, width: 1920, height: 1080 },
					focusOnReady: false,
					window: window as unknown as BrowserWindow,
				},
			],
			origin as unknown as WebContents,
			create,
			activate,
		);
		expect(create).not.toHaveBeenCalled();
		expect(activate).not.toHaveBeenCalled();
		selection.start();
		selection.start();
		expect(activate).toHaveBeenCalledOnce();
		expect(activate).toHaveBeenCalledWith(window, false);
		selection.complete(null, window.webContents as unknown as WebContents);
	});
	it("keeps the selection active when an invalid rectangle is submitted", async () => {
		const { selection, sender, window } = selectionFixture();
		expect(() => selection.complete({ x: 0, y: 0, width: 2, height: 1 }, sender)).toThrow();
		expect(window.destroy).not.toHaveBeenCalled();
		selection.complete(null, sender);
		await expect(selection.result).resolves.toBeNull();
	});
	it("uses the image owned by the selected display and closes every overlay", async () => {
		const origin = contents();
		const leftWindow = windowFixture();
		const rightWindow = windowFixture();
		const rightImage = { ...image, width: 2000, height: 1200, name: "Display 2" };
		const windows = [leftWindow, rightWindow];
		const selection = new ScreenshotRegionSelection(
			[
				{ image, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
				{ image: rightImage, bounds: { x: 0, y: -800, width: 1600, height: 900 } },
			],
			origin as unknown as WebContents,
			() => windows.shift() as unknown as BrowserWindow,
		);
		expect(selection.getImage(leftWindow.webContents as unknown as WebContents)).toBe(image);
		expect(selection.getImage(rightWindow.webContents as unknown as WebContents)).toBe(rightImage);

		selection.complete(
			{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
			rightWindow.webContents as unknown as WebContents,
		);
		await expect(selection.result).resolves.toMatchObject({
			width: 1000,
			height: 600,
			name: "Display 2",
		});
		expect(mocks.crop).toHaveBeenCalledWith({ x: 500, y: 300, width: 1000, height: 600 });
		expect(leftWindow.destroy).toHaveBeenCalledOnce();
		expect(rightWindow.destroy).toHaveBeenCalledOnce();
	});
	it.each([
		"escape",
		"overlay-close",
		"origin-close",
		"renderer-crash",
		"load-failure",
		"timeout",
	])("cleans up on %s", async (reason) => {
		const { selection, sender, origin, window } = selectionFixture();
		if (reason === "escape") selection.complete(null, sender);
		if (reason === "overlay-close") window.destroy();
		if (reason === "origin-close") origin.destroy();
		if (reason === "renderer-crash") window.webContents.emit("render-process-gone");
		if (reason === "load-failure") window.webContents.emit("did-fail-load");
		if (reason === "timeout") await vi.advanceTimersByTimeAsync(120_000);
		await expect(selection.result).resolves.toBeNull();
		expect(window.destroy).toHaveBeenCalledOnce();
		expect(origin.listenerCount("destroyed")).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});
