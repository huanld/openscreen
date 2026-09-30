import type { CursorRecordingSample } from "@/native/contracts";
import { type GuideEvent, type GuideRecordingIdInput } from "./contracts";

export const DEFAULT_GUIDE_SCREENSHOT_OFFSET_MS = 500;
export const DEFAULT_GUIDE_CLICK_DEDUPE_WINDOW_MS = 250;
export const DEFAULT_GUIDE_CLICK_DEDUPE_RADIUS = 0.004;

export interface BuildGuideEventsFromCursorInput {
	recordingId: GuideRecordingIdInput;
	samples: CursorRecordingSample[];
	screenshotOffsetMs?: number;
	dedupeWindowMs?: number;
	dedupeRadius?: number;
	nowIso?: string;
}

export function buildGuideEventsFromCursor(input: BuildGuideEventsFromCursorInput): GuideEvent[] {
	const recordingId = normalizeRecordingId(input.recordingId);
	if (!recordingId) {
		return [];
	}

	const screenshotOffsetMs = Number.isFinite(input.screenshotOffsetMs)
		? Math.max(0, input.screenshotOffsetMs ?? DEFAULT_GUIDE_SCREENSHOT_OFFSET_MS)
		: DEFAULT_GUIDE_SCREENSHOT_OFFSET_MS;
	const createdAt = input.nowIso ?? new Date().toISOString();
	const clickEvents = input.samples
		.filter((sample) => sample.interactionType === "click")
		.map((sample, index): GuideEvent => {
			const timeMs = Number.isFinite(sample.timeMs) ? Math.max(0, sample.timeMs) : 0;
			return {
				id: createGuideEventId(recordingId, timeMs, index),
				recordingId,
				kind: "click",
				source: "cursor-recording",
				timeMs,
				normalizedX: clamp01(sample.cx),
				normalizedY: clamp01(sample.cy),
				button: "left",
				screenshotOffsetMs,
				createdAt,
			};
		});

	return dedupeGuideClickEvents(sortGuideEvents(clickEvents), {
		windowMs: input.dedupeWindowMs ?? DEFAULT_GUIDE_CLICK_DEDUPE_WINDOW_MS,
		radius: input.dedupeRadius ?? DEFAULT_GUIDE_CLICK_DEDUPE_RADIUS,
	});
}

export function mergeGuideEvents(
	events: GuideEvent[],
	options: {
		dedupeWindowMs?: number;
		dedupeRadius?: number;
	} = {},
): GuideEvent[] {
	const cursorEvents = events.filter((event) => event.source === "cursor-recording");
	const nonCursorEvents = events.filter((event) => event.source !== "cursor-recording");
	return sortGuideEvents([
		...dedupeGuideClickEvents(sortGuideEvents(cursorEvents), {
			windowMs: options.dedupeWindowMs ?? DEFAULT_GUIDE_CLICK_DEDUPE_WINDOW_MS,
			radius: options.dedupeRadius ?? DEFAULT_GUIDE_CLICK_DEDUPE_RADIUS,
		}),
		...nonCursorEvents,
	]);
}

export function sortGuideEvents(events: GuideEvent[]): GuideEvent[] {
	return [...events].sort((left, right) => left.timeMs - right.timeMs);
}

export function createGuideEventId(recordingId: string, timeMs: number, index: number): string {
	return `guide-click-${recordingId}-${Math.round(timeMs)}-${index}`;
}

function dedupeGuideClickEvents(
	events: GuideEvent[],
	options: { windowMs: number; radius: number },
): GuideEvent[] {
	const deduped: GuideEvent[] = [];
	for (const event of events) {
		const previous = deduped.at(-1);
		if (previous && isDuplicateClick(previous, event, options)) {
			continue;
		}
		deduped.push(event);
	}
	return deduped;
}

function isDuplicateClick(
	previous: GuideEvent,
	next: GuideEvent,
	options: { windowMs: number; radius: number },
): boolean {
	if (previous.source !== "cursor-recording" || next.source !== "cursor-recording") {
		return false;
	}
	if (next.timeMs - previous.timeMs > options.windowMs) {
		return false;
	}

	const previousX = previous.normalizedX;
	const previousY = previous.normalizedY;
	const nextX = next.normalizedX;
	const nextY = next.normalizedY;
	if (
		previousX === undefined ||
		previousY === undefined ||
		nextX === undefined ||
		nextY === undefined
	) {
		return true;
	}

	const distance = Math.hypot(nextX - previousX, nextY - previousY);
	return distance <= options.radius;
}

function normalizeRecordingId(recordingId: GuideRecordingIdInput): string | null {
	if (typeof recordingId === "number") {
		return Number.isFinite(recordingId) ? String(Math.trunc(recordingId)) : null;
	}
	if (typeof recordingId !== "string") {
		return null;
	}
	const trimmed = recordingId.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function clamp01(value: number): number | undefined {
	if (!Number.isFinite(value)) {
		return undefined;
	}
	return Math.min(1, Math.max(0, value));
}
