import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotService } from "./screenshotService";

const mocks = vi.hoisted(() => ({
	getSources: vi.fn(),
	getAllWindows: vi.fn(),
	getFocusedWindow: vi.fn(),
	getAllDisplays: vi.fn(),
	getDisplayNearestPoint: vi.fn(),
	createFromBuffer: vi.fn(),
}));
vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: mocks.getAllWindows, getFocusedWindow: mocks.getFocusedWindow },
	desktopCapturer: { getSources: mocks.getSources },
	screen: {
		getAllDisplays: mocks.getAllDisplays,
		getDisplayNearestPoint: mocks.getDisplayNearestPoint,
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
	},
	systemPreferences: { getMediaAccessStatus: () => "granted" },
	nativeImage: { createFromBuffer: mocks.createFromBuffer },
	clipboard: {},
	dialog: {},
}));

function appWindow(overrides: { visible?: boolean; minimized?: boolean } = {}) {
	return {
		isDestroyed: () => false,
		isVisible: () => overrides.visible ?? true,
		isMinimized: () => overrides.minimized ?? false,
		getMediaSourceId: () => "window:77:0",
		hide: vi.fn(),
		showInactive: vi.fn(),
		focus: vi.fn(),
	};
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

const source = {
	id: "screen:0:0",
	display_id: "7",
	name: "High density display",
	thumbnail: {
		isEmpty: () => false,
		getScaleFactors: () => [1],
		getSize: () => ({ width: 3840, height: 2160 }),
		toPNG: () => pngHeader(3840, 2160),
		toJPEG: () => Buffer.from("captured JPEG"),
		resize: vi.fn((size: { width: number; height: number }) => ({
			isEmpty: () => false,
			getScaleFactors: () => [1],
			getSize: () => size,
			toPNG: () => pngHeader(size.width, size.height),
			toJPEG: () => Buffer.from("resized JPEG"),
		})),
	},
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocks.getAllWindows.mockReturnValue([]);
	mocks.getFocusedWindow.mockReturnValue(null);
	mocks.getAllDisplays.mockReturnValue([
		{
			id: 7,
			size: { width: 1920, height: 1080 },
			bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
			scaleFactor: 2,
		},
	]);
	mocks.getDisplayNearestPoint.mockReturnValue({ id: 7 });
	mocks.getSources.mockResolvedValue([source]);
});

function regionWindows() {
	let originDestroyed = false;
	let overlayDestroyed = false;
	const origin = Object.assign(new EventEmitter(), {
		isDestroyed: () => originDestroyed,
		destroy: () => {
			originDestroyed = true;
			origin.emit("destroyed");
		},
	});
	const overlay = Object.assign(new EventEmitter(), {
		webContents: Object.assign(new EventEmitter(), { isDestroyed: () => overlayDestroyed }),
		isDestroyed: () => overlayDestroyed,
		destroy: vi.fn(() => {
			overlayDestroyed = true;
			overlay.emit("closed");
		}),
	});
	return { origin, overlay };
}

describe("region capture orchestration", () => {
	it("covers every available display and keeps app windows hidden until selection ends", async () => {
		const visible = appWindow();
		const { origin, overlay } = regionWindows();
		const openRegionWindow = vi.fn(() => overlay as unknown as BrowserWindow);
		const activateRegionWindow = vi.fn();
		mocks.getAllWindows.mockReturnValue([visible]);
		const service = new ScreenshotService({
			openWindow: vi.fn(),
			openRegionWindow,
			activateRegionWindow,
		});
		const result = service.captureRegion(undefined, origin as unknown as WebContents);
		// The hidden renderer starts loading during the compositor/native capture wait.
		expect(openRegionWindow).toHaveBeenCalledOnce();
		expect(activateRegionWindow).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(180);
		expect(openRegionWindow).toHaveBeenCalledWith(
			{ x: -1920, y: 0, width: 1920, height: 1080 },
			true,
		);
		expect(visible.hide).toHaveBeenCalledOnce();
		expect(visible.showInactive).not.toHaveBeenCalled();
		expect(service.getRegionSelection(overlay.webContents as unknown as WebContents)).toMatchObject(
			{
				dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
				width: 3840,
				height: 2160,
			},
		);
		expect(activateRegionWindow).toHaveBeenCalledWith(overlay, true);
		await expect(service.capture(source.id)).rejects.toThrow(/already being captured/i);
		service.completeRegionSelection(null, overlay.webContents as unknown as WebContents);
		await expect(result).resolves.toBeNull();
		expect(visible.showInactive).toHaveBeenCalledOnce();
		expect(overlay.destroy).toHaveBeenCalledOnce();
		expect(service.getRegionSelection(origin as unknown as WebContents)).toBeNull();
	});

	it("maps reversed capture sources to every display by display_id with mixed DPI bounds", async () => {
		const displays = [
			{
				id: 11,
				size: { width: 1920, height: 1080 },
				bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1,
			},
			{
				id: 22,
				size: { width: 2560, height: 1440 },
				bounds: { x: 0, y: 0, width: 2560, height: 1440 },
				scaleFactor: 1.5,
			},
			{
				id: 33,
				size: { width: 1600, height: 900 },
				bounds: { x: 2560, y: -900, width: 1600, height: 900 },
				scaleFactor: 2,
			},
		];
		const screenSource = (id: string, displayId: number, width: number, height: number) => ({
			id,
			display_id: String(displayId),
			name: `Display ${displayId}`,
			thumbnail: {
				isEmpty: () => false,
				getScaleFactors: () => [1],
				getSize: () => ({ width, height }),
				toPNG: () => Buffer.from(`captured ${displayId}`),
				toJPEG: () => Buffer.from(`captured jpeg ${displayId}`),
				resize: vi.fn((size: { width: number; height: number }) => ({
					isEmpty: () => false,
					getScaleFactors: () => [1],
					getSize: () => size,
					toPNG: () => Buffer.from(`resized ${displayId}`),
					toJPEG: () => Buffer.from(`resized jpeg ${displayId}`),
				})),
			},
		});
		const leftSource = screenSource("screen:0:0", 11, 3840, 2160);
		const sources = [
			screenSource("screen:2:0", 33, 3200, 1800),
			leftSource,
			screenSource("screen:1:0", 22, 3840, 2160),
		];
		mocks.getAllDisplays.mockReturnValue(displays);
		mocks.getDisplayNearestPoint.mockReturnValue(displays[2]);
		mocks.getSources.mockResolvedValue(sources);
		const first = regionWindows();
		const second = regionWindows();
		const third = regionWindows();
		const overlays = [first.overlay, second.overlay, third.overlay];
		const openRegionWindow = vi.fn(() => overlays.shift() as unknown as BrowserWindow);
		const service = new ScreenshotService({ openWindow: vi.fn(), openRegionWindow });

		const result = service.captureRegion(undefined, first.origin as unknown as WebContents);
		await vi.advanceTimersByTimeAsync(180);

		expect(mocks.getSources).toHaveBeenCalledOnce();
		expect(mocks.getSources).toHaveBeenCalledWith(
			expect.objectContaining({ thumbnailSize: { width: 3840, height: 2160 } }),
		);
		expect(leftSource.thumbnail.resize).toHaveBeenCalledWith({
			width: 1920,
			height: 1080,
			quality: "best",
		});
		expect(openRegionWindow.mock.calls.map(([bounds]) => bounds)).toEqual(
			displays.map((display) => display.bounds),
		);
		expect(openRegionWindow.mock.calls.map(([, focusOnReady]) => focusOnReady)).toEqual([
			false,
			false,
			true,
		]);
		expect(
			service.getRegionSelection(first.overlay.webContents as unknown as WebContents),
		).toMatchObject({ name: "Display 11", width: 1920, height: 1080 });
		expect(
			service.getRegionSelection(second.overlay.webContents as unknown as WebContents),
		).toMatchObject({ name: "Display 22", width: 3840, height: 2160 });
		expect(
			service.getRegionSelection(third.overlay.webContents as unknown as WebContents),
		).toMatchObject({ name: "Display 33", width: 3200, height: 1800 });

		service.completeRegionSelection(null, third.overlay.webContents as unknown as WebContents);
		await expect(result).resolves.toBeNull();
		expect(first.overlay.destroy).toHaveBeenCalledOnce();
		expect(second.overlay.destroy).toHaveBeenCalledOnce();
		expect(third.overlay.destroy).toHaveBeenCalledOnce();
	});

	it("normalizes rounded high-density representations to exact scale-1 pixels", async () => {
		const encoded = pngHeader(3840, 2160);
		const toPNG = vi.fn(() => encoded);
		const physical = {
			isEmpty: () => false,
			getScaleFactors: () => [1],
			getSize: () => ({ width: 3840, height: 2160 }),
			resize: vi.fn((size: { width: number; height: number }) => ({
				isEmpty: () => false,
				getScaleFactors: () => [1],
				getSize: () => size,
				toJPEG: () => Buffer.from("logical preview"),
			})),
		};
		mocks.createFromBuffer.mockReturnValue(physical);
		mocks.getSources.mockResolvedValue([
			{
				...source,
				thumbnail: {
					isEmpty: () => false,
					getScaleFactors: () => [2],
					getSize: () => ({ width: 1920, height: 1080 }),
					toPNG,
				},
			},
		]);
		const { origin, overlay } = regionWindows();
		const service = new ScreenshotService({
			openWindow: vi.fn(),
			openRegionWindow: () => overlay as unknown as BrowserWindow,
		});
		const result = service.captureRegion(undefined, origin as unknown as WebContents);
		await vi.advanceTimersByTimeAsync(180);
		expect(toPNG).toHaveBeenCalledWith({ scaleFactor: 2 });
		expect(mocks.createFromBuffer).toHaveBeenCalledWith(encoded);
		service.completeRegionSelection(null, overlay.webContents as unknown as WebContents);
		await expect(result).resolves.toBeNull();
	});

	it("fails safely instead of assigning duplicate display identities by source order", async () => {
		const displays = [
			{
				id: 11,
				size: { width: 1920, height: 1080 },
				bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1,
			},
			{
				id: 22,
				size: { width: 1920, height: 1080 },
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1,
			},
		];
		mocks.getAllDisplays.mockReturnValue(displays);
		mocks.getSources.mockResolvedValue([
			{ ...source, id: "screen:0:0", display_id: "11" },
			{ ...source, id: "screen:1:0", display_id: "11" },
		]);
		const { origin } = regionWindows();
		const openRegionWindow = vi.fn();
		const service = new ScreenshotService({ openWindow: vi.fn(), openRegionWindow });

		const result = expect(
			service.captureRegion(undefined, origin as unknown as WebContents),
		).rejects.toMatchObject({ code: "NOT_FOUND", retryable: true });
		await vi.advanceTimersByTimeAsync(180);
		await result;
		expect(openRegionWindow).not.toHaveBeenCalled();
	});

	it("does not guess multi-display mapping when the backend omits display_id", async () => {
		const displays = [
			{
				id: 11,
				size: { width: 1920, height: 1080 },
				bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1,
			},
			{
				id: 22,
				size: { width: 1920, height: 1080 },
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1,
			},
		];
		mocks.getAllDisplays.mockReturnValue(displays);
		mocks.getSources.mockResolvedValue([
			{ ...source, id: "screen:1:0", display_id: "" },
			{ ...source, id: "screen:0:0", display_id: "" },
		]);
		const { origin } = regionWindows();
		const openRegionWindow = vi.fn();
		const service = new ScreenshotService({ openWindow: vi.fn(), openRegionWindow });

		const result = expect(
			service.captureRegion(undefined, origin as unknown as WebContents),
		).rejects.toMatchObject({ code: "NOT_FOUND", retryable: true });
		await vi.advanceTimersByTimeAsync(180);
		await result;
		expect(openRegionWindow).not.toHaveBeenCalled();
	});

	it("cancels safely when display bounds or DPI change during native capture", async () => {
		const initialDisplay = mocks.getAllDisplays()[0];
		const changedDisplay = {
			...initialDisplay,
			bounds: { x: -1600, y: 0, width: 1600, height: 900 },
			scaleFactor: 1.5,
		};
		mocks.getAllDisplays
			.mockReturnValueOnce([initialDisplay])
			.mockReturnValueOnce([changedDisplay]);
		const visible = appWindow();
		mocks.getAllWindows.mockReturnValue([visible]);
		const { origin } = regionWindows();
		const openRegionWindow = vi.fn();
		const service = new ScreenshotService({ openWindow: vi.fn(), openRegionWindow });

		const result = expect(
			service.captureRegion(undefined, origin as unknown as WebContents),
		).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
		await vi.advanceTimersByTimeAsync(180);
		await result;
		expect(openRegionWindow).not.toHaveBeenCalled();
		expect(visible.showInactive).toHaveBeenCalledOnce();
	});

	it("keeps the tray icon hidden for the whole region selection", async () => {
		const { origin, overlay } = regionWindows();
		const openRegionWindow = vi.fn(() => overlay as unknown as BrowserWindow);
		const restoreTray = vi.fn();
		const service = new ScreenshotService({
			openWindow: vi.fn(),
			openRegionWindow,
			suppressTray: () => restoreTray,
		});
		const result = service.captureRegion(undefined, origin as unknown as WebContents);
		await vi.advanceTimersByTimeAsync(180);
		expect(openRegionWindow).toHaveBeenCalledOnce();
		expect(restoreTray).not.toHaveBeenCalled();
		service.completeRegionSelection(null, overlay.webContents as unknown as WebContents);
		await expect(result).resolves.toBeNull();
		expect(restoreTray).toHaveBeenCalledOnce();
	});

	it("rejects window-source region capture before hiding any windows", async () => {
		const { origin } = regionWindows();
		const service = new ScreenshotService({ openWindow: vi.fn() });
		await expect(
			service.captureRegion("window:123:0", origin as unknown as WebContents),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
		expect(mocks.getSources).not.toHaveBeenCalled();
	});

	it("restores windows immediately when the initiating renderer closes during native capture", async () => {
		const visible = appWindow();
		const { origin, overlay } = regionWindows();
		mocks.getAllWindows.mockReturnValue([visible]);
		let finishCapture: (sources: (typeof source)[]) => void = () => undefined;
		const pendingCapture = new Promise<(typeof source)[]>((resolve) => {
			finishCapture = resolve;
		});
		mocks.getSources.mockResolvedValueOnce([source]).mockReturnValueOnce(pendingCapture);
		const openRegionWindow = vi.fn(() => overlay as unknown as BrowserWindow);
		const service = new ScreenshotService({ openWindow: vi.fn(), openRegionWindow });
		const result = service.captureRegion(source.id, origin as unknown as WebContents);
		await vi.advanceTimersByTimeAsync(180);
		origin.destroy();
		await expect(result).resolves.toBeNull();
		expect(visible.showInactive).toHaveBeenCalledOnce();
		expect(openRegionWindow).not.toHaveBeenCalled();
		await expect(service.capture(source.id)).rejects.toThrow(/already being captured/i);
		finishCapture([source]);
		await pendingCapture;
		const retry = service.capture(source.id);
		await vi.runAllTimersAsync();
		await expect(retry).resolves.toMatchObject({ width: 3840, height: 2160 });
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("screenshot desktop capture", () => {
	it("requests physical pixels and restores visible windows without unminimizing others", async () => {
		const visible = appWindow();
		const minimized = appWindow({ minimized: true });
		const hidden = appWindow({ visible: false });
		mocks.getAllWindows.mockReturnValue([visible, minimized, hidden]);
		mocks.getFocusedWindow.mockReturnValue(visible);
		const service = new ScreenshotService({ openWindow: vi.fn() });

		const result = service.capture(source.id);
		await vi.runAllTimersAsync();
		await expect(result).resolves.toMatchObject({ width: 3840, height: 2160 });
		expect(mocks.getSources).toHaveBeenLastCalledWith(
			expect.objectContaining({ thumbnailSize: { width: 3840, height: 2160 } }),
		);
		expect(visible.hide).toHaveBeenCalledOnce();
		expect(visible.showInactive).toHaveBeenCalledOnce();
		expect(visible.focus).toHaveBeenCalledOnce();
		expect(minimized.hide).not.toHaveBeenCalled();
		expect(minimized.showInactive).not.toHaveBeenCalled();
		expect(hidden.showInactive).not.toHaveBeenCalled();
	});

	it("rejects stale source IDs without hiding the application or capturing another screen", async () => {
		const visible = appWindow();
		mocks.getAllWindows.mockReturnValue([visible]);
		const service = new ScreenshotService({ openWindow: vi.fn() });
		await expect(service.capture("screen:999:0")).rejects.toMatchObject({
			code: "NOT_FOUND",
			retryable: true,
		});
		expect(visible.hide).not.toHaveBeenCalled();
		expect(mocks.getSources).toHaveBeenCalledOnce();
	});

	it("restores the application if the chosen window closes during capture", async () => {
		const visible = appWindow();
		mocks.getAllWindows.mockReturnValue([visible]);
		mocks.getSources.mockResolvedValueOnce([source]).mockResolvedValueOnce([]);
		const service = new ScreenshotService({ openWindow: vi.fn() });
		const result = expect(service.capture(source.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await vi.runAllTimersAsync();
		await result;
		expect(visible.showInactive).toHaveBeenCalledOnce();
	});

	it("recovers from native capture failure and accepts another capture", async () => {
		const visible = appWindow();
		mocks.getAllWindows.mockReturnValue([visible]);
		mocks.getSources
			.mockResolvedValueOnce([source])
			.mockRejectedValueOnce(new Error("Capture backend stopped"));
		const service = new ScreenshotService({ openWindow: vi.fn() });
		const failed = expect(service.capture(source.id)).rejects.toThrow("Capture backend stopped");
		await vi.runAllTimersAsync();
		await failed;
		expect(visible.showInactive).toHaveBeenCalledOnce();

		const next = service.capture(source.id);
		await vi.runAllTimersAsync();
		await expect(next).resolves.toMatchObject({ width: 3840, height: 2160 });
	});

	it("blocks overlapping captures until the first one restores the windows", async () => {
		const service = new ScreenshotService({ openWindow: vi.fn() });
		const first = service.capture(source.id);
		await expect(service.capture(source.id)).rejects.toMatchObject({
			code: "UNAVAILABLE",
			retryable: true,
		});
		await vi.runAllTimersAsync();
		await first;
		expect(mocks.getSources).toHaveBeenCalledTimes(2);
	});

	it("restores windows on timeout while preventing another request until the native capture settles", async () => {
		const visible = appWindow();
		mocks.getAllWindows.mockReturnValue([visible]);
		let finishNativeCapture: (value: (typeof source)[]) => void = () => undefined;
		const pendingCapture = new Promise<(typeof source)[]>((resolve) => {
			finishNativeCapture = resolve;
		});
		mocks.getSources.mockResolvedValueOnce([source]).mockReturnValueOnce(pendingCapture);
		const service = new ScreenshotService({ openWindow: vi.fn() });
		const failed = expect(service.capture(source.id)).rejects.toThrow(/timed out/i);
		await vi.runAllTimersAsync();
		await failed;
		expect(visible.showInactive).toHaveBeenCalledOnce();
		await expect(service.capture(source.id)).rejects.toThrow(/already being captured/i);

		finishNativeCapture([source]);
		await pendingCapture;
		const retry = service.capture(source.id);
		await vi.runAllTimersAsync();
		await expect(retry).resolves.toMatchObject({ width: 3840, height: 2160 });
	});

	it("rejects an OpenScreen window even when its source ID suffix changes", async () => {
		mocks.getAllWindows.mockReturnValue([appWindow()]);
		const service = new ScreenshotService({ openWindow: vi.fn() });
		await expect(service.capture("window:77:1")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
		expect(mocks.getSources).not.toHaveBeenCalled();
	});

	it("takes the tray icon out of the notification area and puts it back after the capture", async () => {
		const restoreTray = vi.fn();
		const suppressTray = vi.fn(() => restoreTray);
		const service = new ScreenshotService({ openWindow: vi.fn(), suppressTray });

		const result = service.capture(source.id);
		await vi.advanceTimersByTimeAsync(0);
		expect(suppressTray).toHaveBeenCalledOnce();
		expect(restoreTray).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		await expect(result).resolves.toMatchObject({ width: 3840, height: 2160 });
		expect(restoreTray).toHaveBeenCalledOnce();
	});

	it("restores the tray icon when the capture fails", async () => {
		const restoreTray = vi.fn();
		mocks.getSources
			.mockResolvedValueOnce([source])
			.mockRejectedValueOnce(new Error("Capture backend stopped"));
		const service = new ScreenshotService({
			openWindow: vi.fn(),
			suppressTray: () => restoreTray,
		});
		const failed = expect(service.capture(source.id)).rejects.toThrow("Capture backend stopped");
		await vi.runAllTimersAsync();
		await failed;
		expect(restoreTray).toHaveBeenCalledOnce();
	});

	it("leaves the tray icon alone when capturing another application's window", async () => {
		const windowSource = { ...source, id: "window:42:0", display_id: "" };
		mocks.getSources.mockResolvedValue([windowSource]);
		const suppressTray = vi.fn(() => vi.fn());
		const service = new ScreenshotService({ openWindow: vi.fn(), suppressTray });

		const result = service.capture(windowSource.id);
		await vi.runAllTimersAsync();
		await expect(result).resolves.toMatchObject({ width: 3840, height: 2160 });
		expect(suppressTray).not.toHaveBeenCalled();
	});

	it("continues restoring other windows if one window fails to reappear", async () => {
		const first = appWindow();
		const second = appWindow();
		first.showInactive.mockImplementation(() => {
			throw new Error("Window closed while restoring");
		});
		mocks.getAllWindows.mockReturnValue([first, second]);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const service = new ScreenshotService({ openWindow: vi.fn() });
		const result = service.capture(source.id);
		await vi.runAllTimersAsync();
		await result;
		expect(second.showInactive).toHaveBeenCalledOnce();
	});
});
