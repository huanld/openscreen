import type { GuideEvent, GuideSession } from "../contracts";

export interface CaptureGuideSnapshotsInput {
	session: GuideSession;
	videoUrl: string;
	maxWidth?: number;
}

export async function captureGuideSnapshots(
	input: CaptureGuideSnapshotsInput,
): Promise<GuideSession> {
	const events = [...input.session.events].sort((left, right) => left.timeMs - right.timeMs);
	if (events.length === 0) {
		return input.session;
	}

	const video = document.createElement("video");
	video.preload = "auto";
	video.muted = true;
	video.src = input.videoUrl;
	video.playsInline = true;

	try {
		await waitForLoadedMetadata(video);
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Canvas 2D context is unavailable.");
		}

		const sourceWidth = video.videoWidth || 1280;
		const sourceHeight = video.videoHeight || 720;
		const scale = input.maxWidth && sourceWidth > input.maxWidth ? input.maxWidth / sourceWidth : 1;
		canvas.width = Math.max(1, Math.round(sourceWidth * scale));
		canvas.height = Math.max(1, Math.round(sourceHeight * scale));

		let latestSession = input.session;
		const existingSnapshotsByEventId = new Set(
			input.session.snapshots.map((snapshot) => snapshot.eventId),
		);
		for (const event of events) {
			if (existingSnapshotsByEventId.has(event.id)) {
				continue;
			}
			const offsetMs = event.screenshotOffsetMs ?? 500;
			const timeMs = getSnapshotTimeMs(event, offsetMs, video.duration);
			await seekVideo(video, timeMs / 1000);
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			const pngBytes = await canvasToPngBytes(canvas);
			const markerPoint = getSnapshotMarkerPoint(event, canvas.width, canvas.height);
			const markedPngBytes = markerPoint
				? await canvasToMarkedPngBytes(canvas, markerPoint)
				: undefined;
			const result = await window.electronAPI.guide.writeSnapshot({
				recordingId: input.session.recordingId,
				eventId: event.id,
				timeMs,
				offsetMs,
				pngBytes,
				markedPngBytes,
				width: canvas.width,
				height: canvas.height,
			});
			if (!result.success) {
				throw new Error(result.error);
			}
			latestSession = result.data;
		}

		return latestSession;
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}

function getSnapshotTimeMs(event: GuideEvent, offsetMs: number, durationSeconds: number): number {
	const durationMs = Number.isFinite(durationSeconds)
		? durationSeconds * 1000
		: Number.POSITIVE_INFINITY;
	return Math.max(0, Math.min(durationMs, event.timeMs + Math.max(0, offsetMs)));
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
	if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
		return Promise.resolve();
	}

	return waitForVideoEvent(video, "loadedmetadata", "Unable to load video metadata.");
}

function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			window.clearTimeout(timeoutId);
			video.removeEventListener("seeked", handleSeeked);
			video.removeEventListener("error", handleError);
		};
		const handleSeeked = () => {
			cleanup();
			resolve();
		};
		const handleError = () => {
			cleanup();
			reject(new Error("Unable to seek video for guide snapshot."));
		};
		const timeoutId = window.setTimeout(() => {
			cleanup();
			reject(new Error("Timed out while seeking video for guide snapshot."));
		}, 8000);
		video.addEventListener("seeked", handleSeeked, { once: true });
		video.addEventListener("error", handleError, { once: true });
		video.currentTime = Math.max(0, timeSeconds);
	});
}

function waitForVideoEvent(
	video: HTMLVideoElement,
	eventName: keyof HTMLMediaElementEventMap,
	errorMessage: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			window.clearTimeout(timeoutId);
			video.removeEventListener(eventName, handleReady);
			video.removeEventListener("error", handleError);
		};
		const handleReady = () => {
			cleanup();
			resolve();
		};
		const handleError = () => {
			cleanup();
			reject(new Error(errorMessage));
		};
		const timeoutId = window.setTimeout(() => {
			cleanup();
			reject(new Error(errorMessage));
		}, 8000);
		video.addEventListener(eventName, handleReady, { once: true });
		video.addEventListener("error", handleError, { once: true });
		video.load();
	});
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Unable to encode guide snapshot PNG."));
				return;
			}
			blob.arrayBuffer().then(resolve, reject);
		}, "image/png");
	});
}

async function canvasToMarkedPngBytes(
	canvas: HTMLCanvasElement,
	point: { x: number; y: number },
): Promise<ArrayBuffer> {
	const markedCanvas = document.createElement("canvas");
	markedCanvas.width = canvas.width;
	markedCanvas.height = canvas.height;
	const markedContext = markedCanvas.getContext("2d");
	if (!markedContext) {
		throw new Error("Canvas 2D context is unavailable.");
	}
	markedContext.drawImage(canvas, 0, 0);
	drawSnapshotMarker(markedContext, markedCanvas, point);
	return await canvasToPngBytes(markedCanvas);
}

function drawSnapshotMarker(
	context: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	point: { x: number; y: number },
) {
	const shortSide = Math.max(1, Math.min(canvas.width, canvas.height));
	const dotRadius = clampNumber(Math.round(shortSide * 0.005), 4, 7);

	context.beginPath();
	context.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
	context.fillStyle = "rgba(220, 38, 38, 0.92)";
	context.fill();
}

function getSnapshotMarkerPoint(
	event: GuideEvent,
	width: number,
	height: number,
): { x: number; y: number } | null {
	if (event.kind !== "click" && event.kind !== "hotkey") {
		return null;
	}
	if (isNormalizedNumber(event.normalizedX) && isNormalizedNumber(event.normalizedY)) {
		return {
			x: clampNumber(event.normalizedX * width, 0, width),
			y: clampNumber(event.normalizedY * height, 0, height),
		};
	}
	if (isNormalizedNumber(event.x) && isNormalizedNumber(event.y)) {
		return {
			x: clampNumber(event.x * width, 0, width),
			y: clampNumber(event.y * height, 0, height),
		};
	}
	if (
		typeof event.x === "number" &&
		typeof event.y === "number" &&
		Number.isFinite(event.x) &&
		Number.isFinite(event.y)
	) {
		return {
			x: clampNumber(event.x, 0, width),
			y: clampNumber(event.y, 0, height),
		};
	}
	return null;
}

function isNormalizedNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampNumber(value: number, min = 0, max = Number.POSITIVE_INFINITY): number {
	return Math.min(max, Math.max(min, value));
}
