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
		for (const event of events) {
			const offsetMs = event.screenshotOffsetMs ?? 500;
			const timeMs = getSnapshotTimeMs(event, offsetMs, video.duration);
			await seekVideo(video, timeMs / 1000);
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			const pngBytes = await canvasToPngBytes(canvas);
			const result = await window.electronAPI.guide.writeSnapshot({
				recordingId: input.session.recordingId,
				eventId: event.id,
				timeMs,
				offsetMs,
				pngBytes,
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
