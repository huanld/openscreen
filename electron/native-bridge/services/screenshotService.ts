import fs from "node:fs/promises";
import path from "node:path";
import {
	BrowserWindow,
	clipboard,
	type DesktopCapturerSource,
	type Display,
	desktopCapturer,
	dialog,
	type NativeImage,
	type Rectangle,
	type SourcesOptions,
	screen,
	systemPreferences,
	type WebContents,
} from "electron";
import type { ScreenshotImage, ScreenshotSaveResult } from "../../../src/native/contracts";
import {
	decodeScreenshotBuffer,
	decodeScreenshotDataUrl,
	MAX_SCREENSHOT_BYTES,
	ScreenshotError,
	screenshotImageResult,
	validateScreenshotSize,
} from "./screenshotImage";
import { ScreenshotRegionSelection } from "./screenshotRegion";

const CAPTURE_TIMEOUT_MS = 15_000;

async function waitForCapture(pending: Promise<DesktopCapturerSource[]>, signal?: AbortSignal) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				onAbort = () =>
					reject(new ScreenshotError("UNAVAILABLE", "Screen selection was canceled."));
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new ScreenshotError(
								"UNAVAILABLE",
								"Screen capture timed out. Check screen recording permissions and try again.",
								true,
							),
						),
					CAPTURE_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
	}
}

function sourceWindowId(id: string) {
	return id.split(":").slice(0, 2).join(":");
}

function sourceDisplay(
	source: DesktopCapturerSource,
	sources: DesktopCapturerSource[],
	displays: Display[],
) {
	const explicit = displays.find((display) => String(display.id) === source.display_id);
	if (explicit) return explicit;
	// A non-empty display_id is authoritative. If it no longer resolves, the
	// display topology changed and falling back by array position could show or
	// capture pixels from the wrong monitor.
	if (source.display_id) return undefined;
	// Some capture backends omit display_id; use their screen index only when valid.
	const sourceIndex = Number(source.id.split(":")[1]);
	if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < displays.length) {
		return displays[sourceIndex];
	}
	return sources.length === 1 && displays.length === 1 ? displays[0] : undefined;
}

function screenSourcesByDisplay(
	sources: DesktopCapturerSource[],
	displays: Display[],
	allowIndexFallback = true,
) {
	const screenSources = sources.filter((source) => source.id.startsWith("screen:"));
	const remainingSources = new Set(screenSources);
	const remainingDisplays = new Set(displays);
	const matches = new Map<Display, DesktopCapturerSource>();

	// display_id is the only stable cross-API identity. Resolve it first so a
	// backend source order that differs from screen.getAllDisplays() cannot swap
	// the frozen image shown on two monitors.
	for (const display of displays) {
		const candidates = screenSources.filter(
			(source) => remainingSources.has(source) && source.display_id === String(display.id),
		);
		if (candidates.length !== 1) continue;
		const [source] = candidates;
		matches.set(display, source);
		remainingDisplays.delete(display);
		remainingSources.delete(source);
	}

	// When display_id is unavailable, a unique physical pixel size can still
	// identify a monitor without relying on backend ordering. Identical-size
	// displays deliberately remain unresolved instead of risking swapped images.
	for (const display of [...remainingDisplays]) {
		const expectedSize = displayCaptureSize(display);
		const displaysWithSize = [...remainingDisplays].filter((candidate) => {
			const size = displayCaptureSize(candidate);
			return size.width === expectedSize.width && size.height === expectedSize.height;
		});
		if (displaysWithSize.length !== 1) continue;
		const candidates = [...remainingSources].filter((source) => {
			if (source.display_id) return false;
			const size = imagePixelSize(source.thumbnail);
			return size.width === expectedSize.width && size.height === expectedSize.height;
		});
		if (candidates.length !== 1) continue;
		matches.set(display, candidates[0]);
		remainingDisplays.delete(display);
		remainingSources.delete(candidates[0]);
	}

	// Some capture backends omit display_id. Fall back to their numeric screen
	// index only for still-unmatched entries, and never overwrite an explicit
	// identity resolved above.
	if (allowIndexFallback) {
		for (const source of remainingSources) {
			if (source.display_id) continue;
			const sourceIndex = Number(source.id.split(":")[1]);
			const display = Number.isInteger(sourceIndex) ? displays[sourceIndex] : undefined;
			if (!display || !remainingDisplays.has(display)) continue;
			matches.set(display, source);
			remainingDisplays.delete(display);
			remainingSources.delete(source);
		}
	}

	// Preserve support for platforms whose screen IDs carry neither display_id
	// nor a usable index, but only when there is an unambiguous one-to-one tail.
	const fallbackSources = [...remainingSources].filter((source) => !source.display_id);
	if (
		allowIndexFallback &&
		remainingDisplays.size === 1 &&
		remainingSources.size === 1 &&
		fallbackSources.length === 1
	) {
		matches.set([...remainingDisplays][0], fallbackSources[0]);
	}

	return displays.flatMap((display) => {
		const source = matches.get(display);
		return source ? [{ display, source }] : [];
	});
}

function captureSizeForDisplays(displays: Display[]) {
	if (displays.length === 0)
		throw new ScreenshotError("UNAVAILABLE", "No displays are available.", true);
	const size = {
		width: Math.max(
			...displays.map((display) => Math.round(display.size.width * display.scaleFactor)),
		),
		height: Math.max(
			...displays.map((display) => Math.round(display.size.height * display.scaleFactor)),
		),
	};
	validateScreenshotSize(size.width, size.height);
	return size;
}

function displayCaptureSize(display: Display) {
	return captureSizeForDisplays([display]);
}

function imagePixelSize(image: NativeImage) {
	const scaleFactor = Math.max(...image.getScaleFactors(), 1);
	if (scaleFactor === 1) return { ...image.getSize(), scaleFactor };
	// getSize(scaleFactor) is rounded in DIPs and can be off by a physical
	// pixel at 125%/150% DPI. PNG's IHDR preserves the exact representation.
	const png = image.toPNG({ scaleFactor });
	if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR") {
		throw new ScreenshotError("UNAVAILABLE", "The captured screen image is invalid.", true);
	}
	return {
		width: png.readUInt32BE(16),
		height: png.readUInt32BE(20),
		scaleFactor,
	};
}

function nativeImageForDisplay(source: DesktopCapturerSource, display: Display) {
	const expected = displayCaptureSize(display);
	const scaleFactor = Math.max(...source.thumbnail.getScaleFactors(), 1);
	// Raw bitmap dimensions cannot be reconstructed reliably from rounded DIP
	// sizes at fractional DPI. Decode the chosen representation once at scale 1.
	let image =
		scaleFactor === 1
			? source.thumbnail
			: decodeScreenshotBuffer(source.thumbnail.toPNG({ scaleFactor }));
	const actual = image.getSize();
	validateScreenshotSize(actual.width, actual.height);
	if (actual.width !== expected.width || actual.height !== expected.height) {
		image = image.resize({ ...expected, quality: "best" });
	}
	if (image.isEmpty())
		throw new ScreenshotError(
			"UNAVAILABLE",
			"The source returned an empty image. Try another screen or window.",
			true,
		);
	return image;
}

function screenshotRegionImageForDisplay(source: DesktopCapturerSource, display: Display) {
	const capture = nativeImageForDisplay(source, display);
	const { width, height } = capture.getSize();
	validateScreenshotSize(width, height);
	const previewSize = {
		width: Math.max(1, Math.min(width, Math.round(display.bounds.width))),
		height: Math.max(1, Math.min(height, Math.round(display.bounds.height))),
	};
	const preview =
		previewSize.width === width && previewSize.height === height
			? capture
			: capture.resize({ ...previewSize, quality: "good" });
	const jpeg = preview.toJPEG(90);
	if (jpeg.length === 0 || jpeg.length > MAX_SCREENSHOT_BYTES) {
		throw new ScreenshotError("INVALID_REQUEST", "The captured preview exceeds 64 MB.");
	}
	return {
		image: {
			dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
			width,
			height,
			name: source.name,
		} satisfies ScreenshotImage,
		nativeImage: capture,
	};
}

function sameDisplayTopology(expected: Display[], current: Display[]) {
	if (expected.length !== current.length) return false;
	return expected.every((display) => {
		const match = current.find((candidate) => candidate.id === display.id);
		return (
			match !== undefined &&
			match.bounds.x === display.bounds.x &&
			match.bounds.y === display.bounds.y &&
			match.bounds.width === display.bounds.width &&
			match.bounds.height === display.bounds.height &&
			match.scaleFactor === display.scaleFactor &&
			match.rotation === display.rotation
		);
	});
}

function captureSize(source: DesktopCapturerSource, sources: DesktopCapturerSource[]) {
	const displays = screen.getAllDisplays();
	const display = source.id.startsWith("screen:")
		? sourceDisplay(source, sources, displays)
		: undefined;
	const candidates = display ? [display] : displays;
	return captureSizeForDisplays(candidates);
}

function requireDialogParent(sender: WebContents) {
	const parent = sender.isDestroyed() ? null : BrowserWindow.fromWebContents(sender);
	if (!parent || parent.isDestroyed()) {
		throw new ScreenshotError("UNAVAILABLE", "The screenshot window has closed.");
	}
	return parent;
}

export class ScreenshotService {
	private captureInProgress = false;
	private regionSelection: ScreenshotRegionSelection | null = null;

	constructor(
		private readonly options: {
			openWindow: () => void;
			openRegionWindow?: (bounds: Rectangle, focusOnReady?: boolean) => BrowserWindow;
			activateRegionWindow?: (window: BrowserWindow, focusOnReady: boolean) => void;
			/** Hides the tray icon for the capture; returns the restore call. */
			suppressTray?: () => () => void;
		},
	) {}

	openWindow() {
		this.options.openWindow();
	}

	capture(sourceId: unknown): Promise<ScreenshotImage> {
		return this.acquireCapture(sourceId, (image) => image);
	}

	async captureRegion(sourceId: unknown, sender: WebContents): Promise<ScreenshotImage | null> {
		if (
			sourceId !== undefined &&
			(typeof sourceId !== "string" || !sourceId.startsWith("screen:"))
		) {
			throw new ScreenshotError(
				"INVALID_REQUEST",
				"Region capture requires a display, not a window.",
			);
		}
		if (sender.isDestroyed()) return null;
		const controller = new AbortController();
		const cancel = () => controller.abort();
		sender.once("destroyed", cancel);
		try {
			const beginSelection = async (
				targets: readonly {
					image: ScreenshotImage;
					nativeImage?: NativeImage;
					display?: Display;
					window?: BrowserWindow;
				}[],
			) => {
				if (controller.signal.aborted) {
					for (const target of targets) {
						if (target.window && !target.window.isDestroyed()) target.window.destroy();
					}
					return null;
				}
				if (!this.options.openRegionWindow || targets.some((target) => !target.display))
					throw new ScreenshotError(
						"UNAVAILABLE",
						"One or more displays are no longer available for region capture.",
						true,
					);
				const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
				const focusDisplayId = targets.some((target) => target.display?.id === cursorDisplay.id)
					? cursorDisplay.id
					: targets[0]?.display?.id;
				const selection = new ScreenshotRegionSelection(
					targets.map((target) => ({
						image: target.image,
						nativeImage: target.nativeImage,
						bounds: target.display!.bounds,
						focusOnReady: target.display!.id === focusDisplayId,
						window: target.window,
					})),
					sender,
					this.options.openRegionWindow,
					this.options.activateRegionWindow,
				);
				this.regionSelection = selection;
				try {
					selection.start();
					return await selection.result;
				} finally {
					if (this.regionSelection === selection) this.regionSelection = null;
				}
			};
			if (sourceId === undefined) {
				return await this.acquireAllDisplays(beginSelection, controller.signal);
			}
			return await this.acquireCapture(
				sourceId,
				(image, display) => beginSelection([{ image, display }]),
				controller.signal,
			);
		} catch (error) {
			if (controller.signal.aborted) return null;
			throw error;
		} finally {
			sender.removeListener("destroyed", cancel);
		}
	}

	getRegionSelection(sender: WebContents): ScreenshotImage | null {
		return this.regionSelection?.getImage(sender) ?? null;
	}

	completeRegionSelection(region: unknown, sender: WebContents) {
		if (!this.regionSelection)
			throw new ScreenshotError("UNAVAILABLE", "No screen selection is active.");
		this.regionSelection.complete(region, sender);
	}

	private async acquireCapture<T>(
		sourceId: unknown,
		onCaptured: (image: ScreenshotImage, display?: Display) => T | Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		if (
			typeof sourceId !== "string" ||
			sourceId.length > 256 ||
			!/^(screen|window):\d+(?::[\w-]+)*$/.test(sourceId)
		) {
			throw new ScreenshotError("INVALID_REQUEST", "Choose a screen or window to capture.");
		}
		if (
			sourceId.startsWith("window:") &&
			BrowserWindow.getAllWindows().some(
				(window) => sourceWindowId(window.getMediaSourceId()) === sourceWindowId(sourceId),
			)
		) {
			throw new ScreenshotError(
				"INVALID_REQUEST",
				"Choose a screen or another app's window. OpenScreen hides itself while capturing.",
			);
		}
		const type = sourceId.startsWith("screen:") ? "screen" : "window";
		return this.runCaptureSession(type, signal, async (getSources, prepareDesktop) => {
			const sources = await getSources({
				types: [type],
				thumbnailSize: { width: 0, height: 0 },
			});
			const fallbackDisplayId = /^screen:\d+:fallback:(-?\d+)$/.exec(sourceId)?.[1];
			const source = sources.find((candidate) =>
				fallbackDisplayId
					? String(sourceDisplay(candidate, sources, screen.getAllDisplays())?.id) ===
						fallbackDisplayId
					: candidate.id === sourceId ||
						(type === "window" && sourceWindowId(candidate.id) === sourceWindowId(sourceId)),
			);
			if (!source)
				throw new ScreenshotError(
					"NOT_FOUND",
					"The selected source is no longer available. Refresh the source list.",
					true,
				);
			const thumbnailSize = captureSize(source, sources);
			await prepareDesktop();
			const captured = await getSources({
				types: [type],
				thumbnailSize,
				fetchWindowIcons: false,
			});
			const display =
				type === "screen" ? sourceDisplay(source, sources, screen.getAllDisplays()) : undefined;
			const result = captured.find(
				(candidate) =>
					candidate.id === source.id ||
					(type === "window" && sourceWindowId(candidate.id) === sourceWindowId(source.id)) ||
					(type === "screen" &&
						display &&
						sourceDisplay(candidate, captured, screen.getAllDisplays())?.id === display.id),
			);
			if (!result)
				throw new ScreenshotError(
					"NOT_FOUND",
					"The selected source closed before the screenshot was captured.",
					true,
				);
			return await onCaptured(screenshotImageResult(result.thumbnail, result.name), display);
		});
	}

	private async acquireAllDisplays<T>(
		onCaptured: (
			captures: readonly {
				image: ScreenshotImage;
				nativeImage: NativeImage;
				display: Display;
				window?: BrowserWindow;
			}[],
		) => T | Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const displays = screen.getAllDisplays();
		const thumbnailSize = captureSizeForDisplays(displays);
		return this.runCaptureSession("screen", signal, async (getSources, prepareDesktop) => {
			const preparedWindows = new Map<number, BrowserWindow>();
			const desktopReady = prepareDesktop();
			try {
				// Load the renderer while the compositor settles and Electron acquires
				// pixels. On Windows this removes the cold BrowserWindow/React startup
				// from the user-visible Ctrl+R critical path.
				if (this.options.openRegionWindow && this.options.activateRegionWindow) {
					const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
					for (const display of displays) {
						preparedWindows.set(
							display.id,
							this.options.openRegionWindow(display.bounds, display.id === cursorDisplay.id),
						);
					}
				}
				await desktopReady;
				// The shortcut already knows the complete display topology, so it can
				// acquire all frozen screen images in one native call instead of first
				// enumerating thumbnail-free sources and then capturing again.
				const captured = await getSources({
					types: ["screen"],
					thumbnailSize,
					fetchWindowIcons: false,
				});
				const currentDisplays = screen.getAllDisplays();
				if (!sameDisplayTopology(displays, currentDisplays)) {
					throw new ScreenshotError(
						"UNAVAILABLE",
						"The display configuration changed during capture. Try again.",
						true,
					);
				}
				const screenSources = captured.filter((source) => source.id.startsWith("screen:"));
				let matches = screenSourcesByDisplay(screenSources, displays, displays.length === 1);
				// PipeWire exposes a single portal-selected source even when Electron's
				// screen API sees several displays. Keep region capture usable on Linux
				// by placing that source on the display nearest the pointer.
				if (
					process.platform === "linux" &&
					displays.length > 1 &&
					screenSources.length === 1 &&
					matches.length === 0
				) {
					const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
					const target = displays.find((display) => display.id === cursorDisplay.id) ?? displays[0];
					matches = [{ display: target, source: screenSources[0] }];
				}
				if (
					matches.length === 0 ||
					(process.platform !== "linux" && matches.length !== displays.length)
				) {
					throw new ScreenshotError(
						"NOT_FOUND",
						"One or more displays could not be captured. Reconnect them and try again.",
						true,
					);
				}
				if (matches.length !== displays.length) {
					console.warn("[screenshot] capture backend exposed only part of the display topology", {
						displays: displays.length,
						sources: screenSources.length,
						matched: matches.length,
					});
				}
				const matchedDisplayIds = new Set(matches.map(({ display }) => display.id));
				for (const [displayId, window] of preparedWindows) {
					if (matchedDisplayIds.has(displayId)) continue;
					if (!window.isDestroyed()) window.destroy();
					preparedWindows.delete(displayId);
				}
				// A single native call keeps Ctrl+R responsive. Some backends scale all
				// thumbnails to the largest request; normalize those images back to each
				// display's physical dimensions before the overlay consumes them.
				return await onCaptured(
					matches.map(({ display, source }) => ({
						display,
						...screenshotRegionImageForDisplay(source, display),
						window: preparedWindows.get(display.id),
					})),
				);
			} finally {
				// Selection normally owns and closes these. Capture/mapping failures
				// still need to dispose renderers that were prepared in parallel.
				await desktopReady.catch(() => undefined);
				for (const window of preparedWindows.values()) {
					if (!window.isDestroyed()) window.destroy();
				}
			}
		});
	}

	private async runCaptureSession<T>(
		type: "screen" | "window",
		signal: AbortSignal | undefined,
		operation: (
			getSources: (options: SourcesOptions) => Promise<DesktopCapturerSource[]>,
			prepareDesktop: () => Promise<void>,
		) => Promise<T>,
	): Promise<T> {
		if (this.captureInProgress)
			throw new ScreenshotError("UNAVAILABLE", "A screenshot is already being captured.", true);
		if (
			process.platform === "darwin" &&
			systemPreferences.getMediaAccessStatus("screen") !== "granted"
		) {
			throw new ScreenshotError(
				"UNAVAILABLE",
				"Allow OpenScreen screen recording in System Settings, then try again.",
				true,
			);
		}

		const ownWindows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
		const hiddenWindows: BrowserWindow[] = [];
		let restoreTray: (() => void) | undefined;
		const focusedWindow = BrowserWindow.getFocusedWindow();
		this.captureInProgress = true;
		let pendingSources: Promise<DesktopCapturerSource[]> | undefined;
		let desktopPrepared = false;
		const getSources = (options: SourcesOptions) => {
			pendingSources = desktopCapturer.getSources(options);
			return waitForCapture(pendingSources, signal);
		};
		const prepareDesktop = async () => {
			if (desktopPrepared) return;
			desktopPrepared = true;
			// Hiding our windows leaves the tray icon in the notification area,
			// which a full-screen capture would include. Another app's window
			// never contains it, so only screen captures pay the tray rebuild.
			if (type === "screen") restoreTray = this.options.suppressTray?.();
			for (const window of ownWindows) {
				if (!window.isDestroyed() && window.isVisible() && !window.isMinimized()) {
					hiddenWindows.push(window);
					window.hide();
				}
			}
			// Allow the desktop compositor to remove our windows before acquiring pixels.
			await new Promise((resolve) => setTimeout(resolve, 180));
			if (signal?.aborted)
				throw new ScreenshotError("UNAVAILABLE", "Screen selection was canceled.");
		};
		try {
			return await operation(getSources, prepareDesktop);
		} finally {
			try {
				restoreTray?.();
			} catch (error) {
				console.error("Failed to restore the tray icon after screenshot capture:", error);
			}
			for (const window of hiddenWindows) {
				try {
					if (!window.isDestroyed()) window.showInactive();
				} catch (error) {
					console.error("Failed to restore a window after screenshot capture:", error);
				}
			}
			// A timed-out native request may still be running; keep the guard until it settles.
			if (pendingSources) {
				void pendingSources.then(
					() => {
						this.captureInProgress = false;
					},
					() => {
						this.captureInProgress = false;
					},
				);
			} else {
				this.captureInProgress = false;
			}
			if (focusedWindow && !focusedWindow.isDestroyed() && hiddenWindows.includes(focusedWindow)) {
				try {
					focusedWindow.focus();
				} catch (error) {
					console.error("Failed to focus the window after screenshot capture:", error);
				}
			}
		}
	}

	async openImage(sender: WebContents): Promise<ScreenshotImage | null> {
		const parent = requireDialogParent(sender);
		const result = await dialog.showOpenDialog(parent, {
			properties: ["openFile"],
			filters: [{ name: "PNG / JPEG", extensions: ["png", "jpg", "jpeg"] }],
		});
		if (result.canceled || !result.filePaths[0]) return null;
		const filePath = result.filePaths[0];
		const file = await fs.open(filePath, "r");
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > MAX_SCREENSHOT_BYTES)
				throw new ScreenshotError(
					"INVALID_REQUEST",
					"Choose a PNG or JPEG file smaller than 64 MB.",
				);
			const bytes = await file.readFile();
			return screenshotImageResult(decodeScreenshotBuffer(bytes), path.basename(filePath));
		} finally {
			await file.close();
		}
	}

	async saveImage(
		dataUrl: unknown,
		format: unknown,
		sender: WebContents,
	): Promise<ScreenshotSaveResult> {
		if (format !== "png" && format !== "jpeg")
			throw new ScreenshotError("INVALID_REQUEST", "Choose PNG or JPEG export.");
		const image = decodeScreenshotDataUrl(dataUrl);
		const parent = requireDialogParent(sender);
		const extension = format === "jpeg" ? "jpg" : "png";
		const result = await dialog.showSaveDialog(parent, {
			defaultPath: `Screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
			filters: [
				{ name: format.toUpperCase(), extensions: format === "jpeg" ? ["jpg", "jpeg"] : ["png"] },
			],
			properties: ["createDirectory", "showOverwriteConfirmation"],
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const bytes = format === "jpeg" ? image.toJPEG(92) : image.toPNG();
		if (bytes.length > MAX_SCREENSHOT_BYTES)
			throw new ScreenshotError("INVALID_REQUEST", "The exported image exceeds 64 MB.");
		await fs.writeFile(result.filePath, bytes);
		return { canceled: false, path: result.filePath };
	}

	copyImage(dataUrl: unknown) {
		clipboard.writeImage(decodeScreenshotDataUrl(dataUrl));
	}
}
