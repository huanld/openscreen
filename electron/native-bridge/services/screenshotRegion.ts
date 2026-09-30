import type { BrowserWindow, NativeImage, Rectangle, WebContents } from "electron";
import type { ScreenshotImage, ScreenshotRegion } from "../../../src/native/contracts";
import { decodeScreenshotDataUrl, ScreenshotError, screenshotImageResult } from "./screenshotImage";

const REGION_SELECTION_TIMEOUT_MS = 120_000;

export function regionToPixels(region: unknown, width: number, height: number): Rectangle {
	if (!region || typeof region !== "object")
		throw new ScreenshotError("INVALID_REQUEST", "Choose a rectangle on the screen.");
	const candidate = region as ScreenshotRegion;
	const values = [candidate.x, candidate.y, candidate.width, candidate.height];
	if (
		values.some(
			(value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1,
		) ||
		candidate.width <= 0 ||
		candidate.height <= 0 ||
		candidate.x + candidate.width > 1 + Number.EPSILON * 4 ||
		candidate.y + candidate.height > 1 + Number.EPSILON * 4
	) {
		throw new ScreenshotError(
			"INVALID_REQUEST",
			"The selected rectangle must stay inside the screen.",
		);
	}
	const x = Math.min(width - 1, Math.floor(candidate.x * width));
	const y = Math.min(height - 1, Math.floor(candidate.y * height));
	const right = Math.min(width, Math.ceil((candidate.x + candidate.width) * width));
	const bottom = Math.min(height, Math.ceil((candidate.y + candidate.height) * height));
	return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export interface ScreenshotRegionTarget {
	image: ScreenshotImage;
	/** Scale-1 frozen pixels retained in the main process for the final lossless crop. */
	nativeImage?: NativeImage;
	bounds: Rectangle;
	focusOnReady?: boolean;
	/** A renderer that was loaded while the native screen capture was in progress. */
	window?: BrowserWindow;
}

interface ActiveRegionTarget {
	image: ScreenshotImage;
	nativeImage?: NativeImage;
}

export class ScreenshotRegionSelection {
	readonly windows: readonly BrowserWindow[];
	readonly result: Promise<ScreenshotImage | null>;
	private readonly timer: ReturnType<typeof setTimeout>;
	private readonly overlays = new Map<WebContents, ActiveRegionTarget>();
	private readonly activations: readonly {
		window: BrowserWindow;
		focusOnReady: boolean;
	}[];
	private resolve: (image: ScreenshotImage | null) => void = () => undefined;
	private finished = false;
	private started = false;
	private readonly cancel = () => this.finish(null);

	constructor(
		targets: readonly ScreenshotRegionTarget[],
		private readonly origin: WebContents,
		createWindow: (bounds: Rectangle, focusOnReady?: boolean) => BrowserWindow,
		private readonly activateWindow?: (window: BrowserWindow, focusOnReady: boolean) => void,
	) {
		if (targets.length === 0) {
			throw new ScreenshotError("UNAVAILABLE", "No displays are available for region capture.");
		}
		this.result = new Promise((resolve) => {
			this.resolve = resolve;
		});
		const windows: BrowserWindow[] = [];
		const activations: { window: BrowserWindow; focusOnReady: boolean }[] = [];
		try {
			for (const target of targets) {
				const window = target.window ?? createWindow(target.bounds, target.focusOnReady);
				if (window.isDestroyed() || window.webContents.isDestroyed()) {
					throw new ScreenshotError(
						"UNAVAILABLE",
						"The screen selection window could not be prepared. Try again.",
						true,
					);
				}
				windows.push(window);
				this.overlays.set(window.webContents, {
					image: target.image,
					nativeImage: target.nativeImage,
				});
				activations.push({ window, focusOnReady: target.focusOnReady ?? true });
			}
		} catch (error) {
			for (const window of windows) {
				if (!window.isDestroyed()) window.destroy();
			}
			throw error;
		}
		this.windows = windows;
		this.activations = activations;
		this.timer = setTimeout(this.cancel, REGION_SELECTION_TIMEOUT_MS);
		for (const window of this.windows) {
			window.once("closed", this.cancel);
			window.webContents.once("render-process-gone", this.cancel);
			window.webContents.once("did-fail-load", this.cancel);
		}
		this.origin.once("destroyed", this.cancel);
		if (this.origin.isDestroyed()) this.cancel();
	}

	/** Reveal the already-authorized overlays only after the service owns this selection. */
	start() {
		if (this.started || this.finished) return;
		this.started = true;
		try {
			for (const activation of this.activations) {
				this.activateWindow?.(activation.window, activation.focusOnReady);
			}
		} catch (error) {
			this.finish(null);
			throw error;
		}
	}

	getImage(sender: WebContents): ScreenshotImage {
		return this.authorize(sender).image;
	}

	complete(region: unknown, sender: WebContents) {
		const target = this.authorize(sender);
		if (region === null) {
			this.finish(null);
			return;
		}
		const { image } = target;
		const pixels = regionToPixels(region, image.width, image.height);
		// Region capture retains scale-1 native pixels so the lightweight JPEG preview
		// never affects the exported crop. Imported/legacy images keep the decode fallback.
		const cropped = (target.nativeImage ?? decodeScreenshotDataUrl(image.dataUrl)).crop(pixels);
		this.finish(screenshotImageResult(cropped, image.name));
	}

	private authorize(sender: WebContents) {
		const overlay = this.overlays.get(sender);
		if (this.finished || !overlay || sender.isDestroyed()) {
			throw new ScreenshotError(
				"INVALID_REQUEST",
				"This window cannot access the active screen selection.",
			);
		}
		return overlay;
	}

	private finish(image: ScreenshotImage | null) {
		if (this.finished) return;
		this.finished = true;
		clearTimeout(this.timer);
		this.origin.removeListener("destroyed", this.cancel);
		for (const window of this.windows) {
			window.removeListener("closed", this.cancel);
			window.webContents.removeListener("render-process-gone", this.cancel);
			window.webContents.removeListener("did-fail-load", this.cancel);
			if (!window.isDestroyed()) window.destroy();
		}
		this.overlays.clear();
		this.resolve(image);
	}
}
