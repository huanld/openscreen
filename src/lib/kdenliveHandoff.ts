const DEFAULT_FRAME_RATE = 60;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const MAX_TIMED_REGIONS = 10_000;
// MLT runtime version advertised in the document. Kdenlive only warns when this
// is older than 7.15, so any current MLT 7.x value is safe.
const MLT_VERSION = "7.17.0";
// kdenlive:docproperties.version marks the document structure era. 1.04 files use
// the flat playlist layout written by Kdenlive 22.x; current Kdenlive upgrades
// them silently. Omitting the property (or writing 0) triggers an error dialog.
const KDENLIVE_DOC_VERSION = "1.04";

// Zoom depth presets mirrored from the editor (ZOOM_DEPTH_SCALES) so handoff
// output matches preview without importing editor types.
const ZOOM_DEPTH_SCALES: Record<number, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};
const DEFAULT_ZOOM_DEPTH = 3;
// Zoom in/out ramp length; keyframes are pre-eased so MLT's linear interpolation
// follows an ease-in-out curve and the zoomed hold stays perfectly flat.
const ZOOM_EASE_SECONDS = 0.4;
const ZOOM_EASE_STEPS = 6;
// Cursor-following zoom is sampled at ~12 timeline fps (capped) to keep the
// animated rect compact while staying visually smooth.
const ZOOM_AUTO_STEP_SECONDS = 1 / 12;
const MAX_ZOOM_AUTO_KEYFRAMES = 600;

interface TimedRegion {
	id: string;
	startMs: number;
	endMs: number;
}

interface SpeedTimedRegion extends TimedRegion {
	speed: number;
}

/** Normalized (0-1) point in video space. */
interface ZoomFocusPoint {
	cx: number;
	cy: number;
}

interface CursorSample {
	tMs: number;
	cx: number;
	cy: number;
}

interface ZoomTimedRegion extends TimedRegion {
	depth?: number;
	customScale?: number;
	focus?: ZoomFocusPoint;
	focusMode?: "manual" | "auto";
}

interface AnnotationTimedRegion extends TimedRegion {
	type: string;
	content?: string;
	textContent?: string;
}

export interface KdenliveHandoffInput {
	name: string;
	screenSourcePath: string;
	webcamSourcePath?: string;
	durationMs: number;
	frameRate?: number;
	/** Source video dimensions; fall back to a 1080p profile when unknown. */
	screenWidth?: number;
	screenHeight?: number;
	trimRegions?: readonly TimedRegion[];
	speedRegions?: readonly SpeedTimedRegion[];
	zoomRegions?: readonly ZoomTimedRegion[];
	annotationRegions?: readonly AnnotationTimedRegion[];
	/** Cursor position samples (normalized 0-1) driving auto-focus zoom regions. */
	cursorSamples?: readonly CursorSample[];
}

export interface KdenliveGuide {
	pos: number;
	comment: string;
	type: number;
	duration: number;
}

export interface KdenliveHandoffResult {
	xml: string;
	guides: KdenliveGuide[];
	warnings: string[];
	segmentCount: number;
}

interface FrameRange {
	start: number;
	end: number;
}

interface HandoffSegment extends FrameRange {
	speed: number;
	speedRegionId?: string;
}

/** A playback segment placed on the timeline with trim removal and speed warp applied. */
interface TimelineSegment extends HandoffSegment {
	timelineStart: number;
	timelineFrames: number;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function validateTimedRegions(label: string, regions: readonly TimedRegion[]) {
	if (regions.length > MAX_TIMED_REGIONS) {
		throw new Error(`${label} contains too many regions.`);
	}
	for (const region of regions) {
		if (!Number.isFinite(region.startMs) || !Number.isFinite(region.endMs)) {
			throw new Error(`${label} contains a non-finite time range.`);
		}
	}
}

function msToFrame(ms: number, frameRate: number, totalFrames: number) {
	if (!Number.isFinite(ms)) return 0;
	return clamp(Math.round((ms / 1000) * frameRate), 0, totalFrames);
}

function normalizeRemovedRanges(
	regions: readonly TimedRegion[],
	frameRate: number,
	totalFrames: number,
): FrameRange[] {
	const ranges = regions
		.map((region) => ({
			start: msToFrame(Math.min(region.startMs, region.endMs), frameRate, totalFrames),
			end: msToFrame(Math.max(region.startMs, region.endMs), frameRate, totalFrames),
		}))
		.filter((region) => region.end > region.start)
		.sort((a, b) => a.start - b.start || a.end - b.end);

	const merged: FrameRange[] = [];
	for (const range of ranges) {
		const previous = merged[merged.length - 1];
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

function retainedRanges(totalFrames: number, removed: readonly FrameRange[]): FrameRange[] {
	const ranges: FrameRange[] = [];
	let cursor = 0;
	for (const range of removed) {
		if (cursor < range.start) {
			ranges.push({ start: cursor, end: range.start });
		}
		cursor = Math.max(cursor, range.end);
	}
	if (cursor < totalFrames) {
		ranges.push({ start: cursor, end: totalFrames });
	}
	return ranges;
}

function normalizeSpeedRegions(
	regions: readonly SpeedTimedRegion[],
	frameRate: number,
	totalFrames: number,
) {
	const normalized = regions
		.map((region) => ({
			id: region.id,
			start: msToFrame(Math.min(region.startMs, region.endMs), frameRate, totalFrames),
			end: msToFrame(Math.max(region.startMs, region.endMs), frameRate, totalFrames),
			speed: region.speed,
		}))
		.filter(
			(region) => region.end > region.start && Number.isFinite(region.speed) && region.speed > 0,
		)
		.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

	for (let index = 1; index < normalized.length; index += 1) {
		if (normalized[index].start < normalized[index - 1].end) {
			throw new Error("Speed regions must not overlap.");
		}
	}
	return normalized;
}

function splitRangesBySpeed(
	keptRanges: readonly FrameRange[],
	speedRegions: ReturnType<typeof normalizeSpeedRegions>,
): HandoffSegment[] {
	const result: HandoffSegment[] = [];
	for (const kept of keptRanges) {
		const boundaries = new Set([kept.start, kept.end]);
		for (const speed of speedRegions) {
			if (speed.start < kept.end && speed.end > kept.start) {
				boundaries.add(clamp(speed.start, kept.start, kept.end));
				boundaries.add(clamp(speed.end, kept.start, kept.end));
			}
		}

		const sorted = [...boundaries].sort((a, b) => a - b);
		for (let index = 0; index < sorted.length - 1; index += 1) {
			const start = sorted[index];
			const end = sorted[index + 1];
			if (end <= start) continue;

			const activeSpeed = speedRegions.find((region) => region.start <= start && region.end >= end);
			const segment: HandoffSegment = {
				start,
				end,
				speed: activeSpeed?.speed ?? 1,
				...(activeSpeed ? { speedRegionId: activeSpeed.id } : {}),
			};

			const previous = result[result.length - 1];
			if (
				previous &&
				previous.end === segment.start &&
				previous.speed === segment.speed &&
				previous.speedRegionId === segment.speedRegionId
			) {
				previous.end = segment.end;
			} else {
				result.push(segment);
			}
		}
	}
	return result;
}

function buildTimelineSegments(segments: readonly HandoffSegment[]): {
	segments: TimelineSegment[];
	timelineFrames: number;
} {
	const timelineSegments: TimelineSegment[] = [];
	let timelineFrames = 0;
	for (const segment of segments) {
		const frames = Math.max(
			1,
			toWarpedFrame(segment.end, segment.speed) - toWarpedFrame(segment.start, segment.speed),
		);
		timelineSegments.push({ ...segment, timelineStart: timelineFrames, timelineFrames: frames });
		timelineFrames += frames;
	}
	return { segments: timelineSegments, timelineFrames };
}

/**
 * Map a source frame to its timeline position through trim removal and speed
 * warp; returns null when the frame lies past the last retained segment.
 */
function sourceToTimeline(
	sourceFrame: number,
	timelineSegments: readonly TimelineSegment[],
): number | null {
	for (const segment of timelineSegments) {
		if (sourceFrame < segment.start) return segment.timelineStart;
		if (sourceFrame <= segment.end) {
			return (
				segment.timelineStart +
				toWarpedFrame(sourceFrame, segment.speed) -
				toWarpedFrame(segment.start, segment.speed)
			);
		}
	}
	return null;
}

function markerPosition(
	region: TimedRegion,
	frameRate: number,
	totalFrames: number,
	timelineSegments: readonly TimelineSegment[],
) {
	const start = msToFrame(Math.min(region.startMs, region.endMs), frameRate, totalFrames);
	const end = msToFrame(Math.max(region.startMs, region.endMs), frameRate, totalFrames);
	const segment = timelineSegments.find((range) => end > range.start && start < range.end);
	if (!segment) return null;
	const sourcePosition = Math.max(start, segment.start);
	return (
		segment.timelineStart +
		toWarpedFrame(sourcePosition, segment.speed) -
		toWarpedFrame(segment.start, segment.speed)
	);
}

interface RectPercent {
	x: number;
	y: number;
	w: number;
	h: number;
}

function zoomScaleFor(region: ZoomTimedRegion) {
	if (region.customScale != null && Number.isFinite(region.customScale)) {
		return clamp(region.customScale, 1, 5);
	}
	const depth =
		region.depth != null && Number.isFinite(region.depth)
			? clamp(Math.round(region.depth), 1, 6)
			: DEFAULT_ZOOM_DEPTH;
	return ZOOM_DEPTH_SCALES[depth] ?? ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH];
}

function normalizeFocus(focus: ZoomFocusPoint | undefined): ZoomFocusPoint {
	const cx = focus && Number.isFinite(focus.cx) ? clamp(focus.cx, 0, 1) : 0.5;
	const cy = focus && Number.isFinite(focus.cy) ? clamp(focus.cy, 0, 1) : 0.5;
	return { cx, cy };
}

/** Keep the zoom window fully inside the frame (mirrors the editor's clampFocusToScale). */
function clampFocusForScale(focus: ZoomFocusPoint, scale: number): ZoomFocusPoint {
	const margin = Math.min(0.5, 1 / (2 * scale));
	return {
		cx: clamp(focus.cx, margin, 1 - margin),
		cy: clamp(focus.cy, margin, 1 - margin),
	};
}

/** Visible sub-rect for a scale and focus point, in percent of the frame. */
function zoomedRectPercent(focus: ZoomFocusPoint, scale: number): RectPercent {
	const w = 100 / scale;
	const h = 100 / scale;
	return {
		x: clamp(focus.cx * 100 - w / 2, 0, 100 - w),
		y: clamp(focus.cy * 100 - h / 2, 0, 100 - h),
		w,
		h,
	};
}

const FULL_RECT: RectPercent = { x: 0, y: 0, w: 100, h: 100 };

function lerpRect(from: RectPercent, to: RectPercent, t: number): RectPercent {
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
		w: from.w + (to.w - from.w) * t,
		h: from.h + (to.h - from.h) * t,
	};
}

function easeInOutCubic(t: number) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function rectToken(rect: RectPercent) {
	const component = (value: number) => `${Math.round(value * 100) / 100}%`;
	return `${component(rect.x)} ${component(rect.y)} ${component(rect.w)} ${component(rect.h)} 1`;
}

/** Interpolator over cursor samples in ms; returns null when no samples exist. */
function createCursorFocusLookup(samples: readonly CursorSample[] | undefined) {
	const sorted = (samples ?? [])
		.filter(
			(sample) =>
				Number.isFinite(sample.tMs) && Number.isFinite(sample.cx) && Number.isFinite(sample.cy),
		)
		.map((sample) => ({
			tMs: sample.tMs,
			cx: clamp(sample.cx, 0, 1),
			cy: clamp(sample.cy, 0, 1),
		}))
		.sort((a, b) => a.tMs - b.tMs);

	return (tMs: number): ZoomFocusPoint | null => {
		if (sorted.length === 0) return null;
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (tMs <= first.tMs) return { cx: first.cx, cy: first.cy };
		if (tMs >= last.tMs) return { cx: last.cx, cy: last.cy };
		let lo = 0;
		let hi = sorted.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (sorted[mid].tMs <= tMs) lo = mid;
			else hi = mid;
		}
		const a = sorted[lo];
		const b = sorted[hi];
		const span = b.tMs - a.tMs;
		if (span <= 0) return { cx: a.cx, cy: a.cy };
		const t = (tMs - a.tMs) / span;
		return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
	};
}

interface RectKeyframe {
	frame: number;
	rect: RectPercent;
}

interface ZoomInterval {
	/** Index into the timeline segments; entry index on the screen video track. */
	segmentIndex: number;
	sourceStart: number;
	sourceEnd: number;
	timelineStart: number;
	timelineEnd: number;
}

function zoomIntervalsFor(
	region: ZoomTimedRegion,
	frameRate: number,
	totalFrames: number,
	timelineSegments: readonly TimelineSegment[],
): ZoomInterval[] {
	const sourceStart = msToFrame(Math.min(region.startMs, region.endMs), frameRate, totalFrames);
	const sourceEnd = msToFrame(Math.max(region.startMs, region.endMs), frameRate, totalFrames);
	const intervals: ZoomInterval[] = [];
	timelineSegments.forEach((segment, segmentIndex) => {
		const start = Math.max(sourceStart, segment.start);
		const end = Math.min(sourceEnd, segment.end);
		if (end <= start) return;
		const timelineStart =
			segment.timelineStart +
			toWarpedFrame(start, segment.speed) -
			toWarpedFrame(segment.start, segment.speed);
		const timelineEnd =
			segment.timelineStart +
			toWarpedFrame(end, segment.speed) -
			toWarpedFrame(segment.start, segment.speed);
		if (timelineEnd <= timelineStart) return;
		intervals.push({
			segmentIndex,
			sourceStart: start,
			sourceEnd: end,
			timelineStart,
			timelineEnd,
		});
	});
	return intervals;
}

/**
 * Timeline keyframes animating full frame → zoomed rect → full frame for one
 * zoom region, grouped per timeline segment (== per playlist entry on the
 * screen video track). Ease ramps are pre-eased linear waypoints so the MLT
 * animation needs only linear interpolation, which every MLT build parses
 * identically.
 */
function zoomKeyframesFor(
	region: ZoomTimedRegion,
	frameRate: number,
	totalFrames: number,
	timelineSegments: readonly TimelineSegment[],
	cursorFocusAt: (tMs: number) => ZoomFocusPoint | null,
): Map<number, RectKeyframe[]> {
	const bySegment = new Map<number, RectKeyframe[]>();
	const scale = zoomScaleFor(region);
	if (scale <= 1.001) return bySegment;

	const easeFrames = Math.max(1, Math.round(ZOOM_EASE_SECONDS * frameRate));
	const isAutoFocus = region.focusMode === "auto";
	const manualFocus = clampFocusForScale(normalizeFocus(region.focus), scale);
	const focusAtSourceFrame = (sourceFrame: number) => {
		if (!isAutoFocus) return manualFocus;
		const sample = cursorFocusAt((sourceFrame / frameRate) * 1000);
		return clampFocusForScale(normalizeFocus(sample ?? region.focus), scale);
	};

	const intervals = zoomIntervalsFor(region, frameRate, totalFrames, timelineSegments);
	let lastFrame = -1;
	let bucket: RectKeyframe[] | null = null;
	const push = (frame: number, rect: RectPercent) => {
		const rounded = Math.round(frame);
		if (rounded === lastFrame) {
			bucket![bucket!.length - 1].rect = rect;
			return;
		}
		bucket!.push({ frame: rounded, rect });
		lastFrame = rounded;
	};

	intervals.forEach((interval, index) => {
		const segment = timelineSegments[interval.segmentIndex];
		const entryStart = segment.timelineStart;
		const entryEnd = segment.timelineStart + segment.timelineFrames;
		bucket = [];
		lastFrame = -1;
		bySegment.set(interval.segmentIndex, bucket);
		const focusStartRect = zoomedRectPercent(focusAtSourceFrame(interval.sourceStart), scale);
		const focusEndRect = zoomedRectPercent(focusAtSourceFrame(interval.sourceEnd), scale);

		const prevAdjacent =
			index > 0 && intervals[index - 1].timelineEnd >= interval.timelineStart - 1;
		const nextAdjacent =
			index < intervals.length - 1 &&
			intervals[index + 1].timelineStart <= interval.timelineEnd + 1;

		if (!prevAdjacent) {
			// Ease in from the full frame, clamped so the ramp never crosses into
			// an earlier clip where this filter does not exist.
			const rampStart = Math.max(interval.timelineStart - easeFrames, entryStart);
			for (let step = 0; step <= ZOOM_EASE_STEPS; step += 1) {
				const t = step / ZOOM_EASE_STEPS;
				push(
					rampStart + (interval.timelineStart - rampStart) * t,
					lerpRect(FULL_RECT, focusStartRect, easeInOutCubic(t)),
				);
			}
		} else {
			push(interval.timelineStart, focusStartRect);
		}

		if (isAutoFocus) {
			// Follow the cursor through the hold at a fixed cadence in timeline time.
			const sourceStep = Math.max(1, ZOOM_AUTO_STEP_SECONDS * frameRate * segment.speed);
			const autoKeyframes: RectKeyframe[] = [];
			for (
				let sourceFrame = interval.sourceStart + sourceStep;
				sourceFrame < interval.sourceEnd;
				sourceFrame += sourceStep
			) {
				const timelineFrame = sourceToTimeline(sourceFrame, [segment]);
				if (timelineFrame === null || timelineFrame <= interval.timelineStart) continue;
				if (timelineFrame >= interval.timelineEnd) break;
				autoKeyframes.push({
					frame: timelineFrame,
					rect: zoomedRectPercent(focusAtSourceFrame(sourceFrame), scale),
				});
			}
			const stride = Math.max(1, Math.ceil(autoKeyframes.length / MAX_ZOOM_AUTO_KEYFRAMES));
			for (let index2 = 0; index2 < autoKeyframes.length; index2 += stride) {
				push(autoKeyframes[index2].frame, autoKeyframes[index2].rect);
			}
		}

		if (nextAdjacent) {
			push(interval.timelineEnd, focusEndRect);
		} else {
			// Ease back out to the full frame, clamped to this clip's extent.
			const rampEnd = Math.min(interval.timelineEnd + easeFrames, entryEnd);
			for (let step = 0; step <= ZOOM_EASE_STEPS; step += 1) {
				const t = step / ZOOM_EASE_STEPS;
				push(
					interval.timelineEnd + (rampEnd - interval.timelineEnd) * t,
					lerpRect(focusEndRect, FULL_RECT, easeInOutCubic(t)),
				);
			}
		}
	});

	return bySegment;
}

function truncateMarkerText(value: string | undefined) {
	if (!value) return "";
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

/**
 * MLT resolves media resources as filesystem paths; keep forward slashes so
 * Windows drive and UNC paths survive XML serialization.
 */
export function normalizeKdenliveMediaPath(sourcePath: string) {
	const trimmed = sourcePath.trim();
	if (!trimmed) throw new Error("A source media path is required.");

	if (/^file:/i.test(trimmed)) {
		const url = new URL(trimmed);
		let pathname = decodeURIComponent(url.pathname);
		if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
		return `${url.hostname ? `//${url.hostname}` : ""}${pathname}`.replace(/\\/g, "/");
	}

	return trimmed.replace(/\\/g, "/");
}

function escapeXml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function property(name: string, value: string | number) {
	return `  <property name="${escapeXml(name)}">${escapeXml(String(value))}</property>`;
}

function reduceFraction(numerator: number, denominator: number): [number, number] {
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const divisor = gcd(Math.max(1, Math.round(numerator)), Math.max(1, Math.round(denominator)));
	return [Math.round(numerator / divisor), Math.round(denominator / divisor)];
}

function warpSpeedLabel(speed: number) {
	const rounded = Math.round(speed * 1000) / 1000;
	return String(rounded);
}

/** MLT timewarp time for a source frame position, in warped producer frames. */
function toWarpedFrame(sourceFrame: number, speed: number) {
	return Math.round(sourceFrame / speed);
}

interface MltProducerSpec {
	/** XML producer id referenced by playlist entries. */
	producerId: string;
	/** kdenlive:id linking the producer back to its bin clip. */
	binClipId: number;
	resource: string;
	speed?: number;
	totalFrames: number;
	clipName: string;
}

function buildProducer(spec: MltProducerSpec): string {
	const speed = spec.speed;
	const isWarp = speed !== undefined && speed !== 1;
	const resource = isWarp ? `${warpSpeedLabel(speed)}:${spec.resource}` : spec.resource;
	const length = isWarp ? Math.max(1, toWarpedFrame(spec.totalFrames, speed)) : spec.totalFrames;
	const lines = [
		` <producer id="${spec.producerId}" in="0" out="${Math.max(0, length - 1)}">`,
		property("length", length),
		property("eof", "pause"),
		property("resource", resource),
	];
	if (isWarp) {
		lines.push(property("warp_speed", warpSpeedLabel(speed)));
		lines.push(property("warp_pitch", 0));
		lines.push(property("warp_resource", resource));
		lines.push(property("mlt_service", "timewarp"));
	} else {
		lines.push(property("mlt_service", "avformat-novalidate"));
		lines.push(property("seekable", 1));
	}
	lines.push(property("kdenlive:clipname", spec.clipName));
	lines.push(property("kdenlive:clip_type", 0));
	lines.push(property("kdenlive:folderid", -1));
	lines.push(property("kdenlive:id", spec.binClipId));
	lines.push(" </producer>");
	return lines.join("\n");
}

interface MltTransitionSpec {
	kind: "mix" | "qtblend";
	bTrack: number;
}

function buildTransition(transitionId: number, spec: MltTransitionSpec): string {
	const lines = [` <transition id="transition${transitionId}">`];
	if (spec.kind === "mix") {
		lines.push(property("a_track", 0));
		lines.push(property("b_track", spec.bTrack));
		lines.push(property("mlt_service", "mix"));
		lines.push(property("kdenlive_id", "mix"));
		lines.push(property("internal_added", 237));
		lines.push(property("always_active", 1));
		lines.push(property("accepts_blanks", 1));
		lines.push(property("sum", 1));
	} else {
		lines.push(property("a_track", 0));
		lines.push(property("b_track", spec.bTrack));
		lines.push(property("version", "0.1"));
		lines.push(property("mlt_service", "qtblend"));
		lines.push(property("kdenlive_id", "qtblend"));
		lines.push(property("automatic", 1));
		lines.push(property("background", "colour:black"));
		lines.push(property("compositing", 0));
		lines.push(property("distort", 0));
		lines.push(property("rect", "0 0 100% 100% 1"));
		lines.push(property("opacity", "1"));
		lines.push(property("rotate", 0));
		lines.push(property("rotate_center", 0));
		lines.push(property("threads", 0));
		lines.push(property("internal_added", 237));
		lines.push(property("always_active", 1));
	}
	lines.push(" </transition>");
	return lines.join("\n");
}

/**
 * Serialize one zoom region as a qtblend filter (Kdenlive's "Transform" effect)
 * for a playlist entry. Timeline keyframes are shifted into clip-local frames.
 */
function buildZoomFilterXml(
	keyframes: readonly RectKeyframe[],
	entryTimelineStart: number,
	entryTimelineFrames: number,
	filterId: string,
): string {
	const lastLocalFrame = Math.max(0, entryTimelineFrames - 1);
	const byLocalFrame = new Map<number, RectPercent>();
	for (const keyframe of keyframes) {
		byLocalFrame.set(clamp(keyframe.frame - entryTimelineStart, 0, lastLocalFrame), keyframe.rect);
	}
	const firstFrame = keyframes[0].frame - entryTimelineStart;
	if (firstFrame > 0) {
		// The region continues from the previous clip; pin the entering state at 0.
		byLocalFrame.set(0, keyframes[0].rect);
	}
	const rect = [...byLocalFrame.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([frame, rect2]) => `${frame}=${rectToken(rect2)}`)
		.join(";");

	const lines = [
		`   <filter id="${escapeXml(filterId)}">`,
		property("kdenlive_id", "qtblend"),
		property("mlt_service", "qtblend"),
		property("rect", rect),
		property("distort", 0),
		property("compositing", 0),
		property("threads", 0),
		"   </filter>",
	];
	return lines.join("\n");
}

function buildTimelineMarkers(
	input: KdenliveHandoffInput,
	frameRate: number,
	totalFrames: number,
	timelineSegments: readonly TimelineSegment[],
): KdenliveGuide[] {
	const guides: KdenliveGuide[] = [];
	for (const region of input.zoomRegions ?? []) {
		const position = markerPosition(region, frameRate, totalFrames, timelineSegments);
		if (position === null) continue;
		const scale = region.customScale ?? (region.depth ? `preset ${region.depth}` : undefined);
		guides.push({
			pos: position,
			comment: `OpenScreen zoom${scale ? ` (${scale})` : ""}`,
			type: 0,
			duration: 0,
		});
	}

	for (const region of input.annotationRegions ?? []) {
		const position = markerPosition(region, frameRate, totalFrames, timelineSegments);
		if (position === null) continue;
		const content = truncateMarkerText(region.textContent || region.content);
		const label = region.type === "blur" ? "blur" : `annotation (${region.type})`;
		guides.push({
			pos: position,
			comment: `OpenScreen ${label}${content ? `: ${content}` : ""}`,
			type: 0,
			duration: 0,
		});
	}

	return guides.sort((a, b) => a.pos - b.pos);
}

/**
 * Serialize a one-way Kdenlive handoff as a native `.kdenlive` project
 * (MLT XML) that any Kdenlive version opens directly: trim regions become
 * clip cuts, speed regions become MLT timewarp producers, and effects that
 * MLT cannot recreate are exported as timeline guides.
 */
export function createKdenliveHandoff(input: KdenliveHandoffInput): KdenliveHandoffResult {
	const frameRate = input.frameRate ?? DEFAULT_FRAME_RATE;
	if (!Number.isFinite(frameRate) || frameRate <= 0) {
		throw new Error("The timeline frame rate must be greater than zero.");
	}
	if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
		throw new Error("The source video duration is unavailable.");
	}
	validateTimedRegions("Trim data", input.trimRegions ?? []);
	validateTimedRegions("Speed data", input.speedRegions ?? []);
	validateTimedRegions("Zoom data", input.zoomRegions ?? []);
	validateTimedRegions("Annotation data", input.annotationRegions ?? []);
	for (const region of input.speedRegions ?? []) {
		if (!Number.isFinite(region.speed) || region.speed <= 0) {
			throw new Error("Speed data contains an invalid playback speed.");
		}
	}

	const width =
		Number.isFinite(input.screenWidth) && (input.screenWidth ?? 0) > 0
			? Math.round(input.screenWidth as number)
			: DEFAULT_WIDTH;
	const height =
		Number.isFinite(input.screenHeight) && (input.screenHeight ?? 0) > 0
			? Math.round(input.screenHeight as number)
			: DEFAULT_HEIGHT;
	const [displayAspectNum, displayAspectDen] = reduceFraction(width, height);

	const totalFrames = Math.max(1, Math.round((input.durationMs / 1000) * frameRate));
	const removed = normalizeRemovedRanges(input.trimRegions ?? [], frameRate, totalFrames);
	const kept = retainedRanges(totalFrames, removed);
	if (kept.length === 0) {
		throw new Error("The entire source video is trimmed out.");
	}

	const normalizedSpeedRegions = normalizeSpeedRegions(
		input.speedRegions ?? [],
		frameRate,
		totalFrames,
	);
	const segments = splitRangesBySpeed(kept, normalizedSpeedRegions);
	const { segments: timelineSegments, timelineFrames } = buildTimelineSegments(segments);

	const screenResource = normalizeKdenliveMediaPath(input.screenSourcePath);
	const webcamResource = input.webcamSourcePath
		? normalizeKdenliveMediaPath(input.webcamSourcePath)
		: undefined;
	const screenClipName = screenResource.split("/").pop() || "Screen";
	const webcamClipName = webcamResource?.split("/").pop() || "Webcam";

	// Bin clips: 1 = screen, 2 = webcam (mirrors kdenlive:id numbering).
	const screenProducer: MltProducerSpec = {
		producerId: "producer0",
		binClipId: 1,
		resource: screenResource,
		totalFrames,
		clipName: screenClipName,
	};
	const webcamProducer: MltProducerSpec | null = webcamResource
		? {
				producerId: "producer1",
				binClipId: 2,
				resource: webcamResource,
				totalFrames,
				clipName: webcamClipName,
			}
		: null;

	// One timewarp producer per (media, speed) pair used by the timeline.
	const warpProducers = new Map<string, MltProducerSpec>();
	const warpProducerFor = (media: "screen" | "webcam", speed: number): MltProducerSpec => {
		const key = `${media}:${warpSpeedLabel(speed)}`;
		const existing = warpProducers.get(key);
		if (existing) return existing;
		const base = media === "screen" ? screenProducer : (webcamProducer as MltProducerSpec);
		const spec: MltProducerSpec = {
			producerId: `producer${warpProducers.size + (webcamProducer ? 2 : 1)}`,
			binClipId: base.binClipId,
			resource: base.resource,
			speed,
			totalFrames,
			clipName: `${base.clipName} (${warpSpeedLabel(speed)}x)`,
		};
		warpProducers.set(key, spec);
		return spec;
	};

	const buildTrackEntries = (media: "screen" | "webcam") =>
		segments.map((segment, index) => {
			const timelineSegment = timelineSegments[index];
			if (segment.speed === 1) {
				return {
					producerId: media === "screen" ? screenProducer.producerId : webcamProducer!.producerId,
					inFrame: segment.start,
					outFrame: segment.end - 1,
					binClipId: media === "screen" ? screenProducer.binClipId : webcamProducer!.binClipId,
					timelineStart: timelineSegment.timelineStart,
					timelineEnd: timelineSegment.timelineStart + timelineSegment.timelineFrames,
				};
			}
			const warp = warpProducerFor(media, segment.speed);
			return {
				producerId: warp.producerId,
				inFrame: toWarpedFrame(segment.start, segment.speed),
				outFrame: Math.max(0, toWarpedFrame(segment.end, segment.speed) - 1),
				binClipId: warp.binClipId,
				timelineStart: timelineSegment.timelineStart,
				timelineEnd: timelineSegment.timelineStart + timelineSegment.timelineFrames,
			};
		});

	const screenEntries = buildTrackEntries("screen");
	const webcamEntries = webcamProducer ? buildTrackEntries("webcam") : [];

	const guides = buildTimelineMarkers(input, frameRate, totalFrames, timelineSegments);

	// Replay zoom regions as real keyframed qtblend filters (Kdenlive "Transform"
	// effects) on the screen video track, one filter per affected entry.
	const cursorFocusAt = createCursorFocusLookup(input.cursorSamples);
	const zoomFiltersByEntry = new Map<number, string[]>();
	(input.zoomRegions ?? []).forEach((region, regionIndex) => {
		const keyframesBySegment = zoomKeyframesFor(
			region,
			frameRate,
			totalFrames,
			timelineSegments,
			cursorFocusAt,
		);
		keyframesBySegment.forEach((keyframes, segmentIndex) => {
			const entry = screenEntries[segmentIndex];
			const filterXml = buildZoomFilterXml(
				keyframes,
				entry.timelineStart,
				entry.timelineEnd - entry.timelineStart,
				`zoom_${regionIndex}_${segmentIndex}`,
			);
			const existing = zoomFiltersByEntry.get(segmentIndex);
			if (existing) existing.push(filterXml);
			else zoomFiltersByEntry.set(segmentIndex, [filterXml]);
		});
	});
	const zoomFiltersForScreen = screenEntries.map((_entry, index) => {
		const filters = zoomFiltersByEntry.get(index);
		if (!filters) return null;
		return filters.join("\n");
	});

	const warnings: string[] = [
		"Zoom regions are exported as keyframed Transform (qtblend) effects; cursor-following zoom is approximated from cursor telemetry, and 3D rotation presets are not reproduced.",
		"OpenScreen annotations and blur are exported as timeline guides; recreate them with Kdenlive effects.",
	];
	if (webcamProducer) {
		warnings.push(
			"The webcam is a separate full-frame video track above the screen; adjust its OpenScreen layout and mask in Kdenlive.",
		);
	}

	const producers = [
		buildProducer(screenProducer),
		...(webcamProducer ? [buildProducer(webcamProducer)] : []),
		...[...warpProducers.values()].map((spec) => buildProducer(spec)),
	];

	const mainBin = [
		' <playlist id="main_bin">',
		property("kdenlive:docproperties.activeTrack", 1),
		property("kdenlive:docproperties.documentid", `${Date.now()}`),
		property("kdenlive:docproperties.profile", ""),
		property("kdenlive:docproperties.version", KDENLIVE_DOC_VERSION),
		property("xml_retain", 1),
		`  <entry producer="${screenProducer.producerId}" in="0" out="${totalFrames - 1}"/>`,
		...(webcamProducer
			? [`  <entry producer="${webcamProducer.producerId}" in="0" out="${totalFrames - 1}"/>`]
			: []),
		" </playlist>",
	].join("\n");

	const blackTrack = [
		` <producer id="black_track" in="0" out="${Math.max(0, timelineFrames - 1)}">`,
		property("length", 2147483647),
		property("eof", "continue"),
		property("resource", "black"),
		property("aspect_ratio", 1),
		property("mlt_service", "color"),
		property("mlt_image_format", "rgba"),
		property("set.test_audio", 0),
		" </producer>",
	].join("\n");

	// MLT track order is bottom-to-top: black background, screen video, webcam
	// video (composited above), screen audio last. hide= keeps each track to one
	// stream so the dedicated audio track does not double the video tracks' audio.
	interface TrackSpec {
		playlistId: string;
		entries: typeof screenEntries;
		audio: boolean;
		/** Per-entry qtblend filter XML; only the screen video track carries zoom. */
		zoomFilters?: readonly (string | null)[];
	}
	const tracks: TrackSpec[] = [
		{
			playlistId: "playlist0",
			entries: screenEntries,
			audio: false,
			zoomFilters: zoomFiltersForScreen,
		},
		...(webcamProducer ? [{ playlistId: "playlist1", entries: webcamEntries, audio: false }] : []),
		{
			playlistId: webcamProducer ? "playlist2" : "playlist1",
			entries: screenEntries,
			audio: true,
		},
	];

	const playlists = tracks.map((track) => {
		const lines = [` <playlist id="${track.playlistId}">`];
		if (track.audio) lines.push(`  ${property("kdenlive:audio_track", 1).trimStart()}`);
		track.entries.forEach((entry, entryIndex) => {
			lines.push(
				`  <entry producer="${entry.producerId}" in="${entry.inFrame}" out="${entry.outFrame}">`,
			);
			const zoomFilter = track.zoomFilters?.[entryIndex];
			if (zoomFilter) lines.push(zoomFilter);
			lines.push(`   ${property("kdenlive:id", entry.binClipId).trimStart()}`);
			lines.push("  </entry>");
		});
		lines.push(" </playlist>");
		return lines.join("\n");
	});

	// Audio tracks keep their sound; video tracks stay silent because their audio
	// is hidden, so a single mix transition feeds the timeline audio.
	const transitions: MltTransitionSpec[] = [];
	tracks.forEach((track, index) => {
		const mltTrackIndex = index + 1; // +1 for black_track
		if (track.audio) {
			transitions.push({ kind: "mix", bTrack: mltTrackIndex });
		} else {
			transitions.push({ kind: "qtblend", bTrack: mltTrackIndex });
		}
	});

	const tractor = [
		' <tractor id="tractor0" global_feed="1" in="0" out="' + Math.max(0, timelineFrames - 1) + '">',
		property("kdenlive:trackheight", 68),
		property("kdenlive:timeline_active", 1),
		property("kdenlive:collapsed", 0),
		property("kdenlive:sequenceproperties.guides", JSON.stringify(guides)),
		' <track producer="black_track"/>',
		...tracks.map(
			(track) =>
				` <track hide="${track.audio ? "video" : "audio"}" producer="${track.playlistId}"/>`,
		),
		...transitions.map((spec, index) => buildTransition(index, spec)),
		" </tractor>",
	].join("\n");

	const documentParts = [
		'<?xml version="1.0" encoding="utf-8"?>',
		`<mlt LC_NUMERIC="C" title="${escapeXml(
			input.name.trim() || "OpenScreen handoff",
		)}" producer="main_bin" version="${MLT_VERSION}">`,
		` <profile description="automatic" width="${width}" height="${height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${displayAspectNum}" display_aspect_den="${displayAspectDen}" frame_rate_num="${Math.round(
			frameRate * 1000,
		)}" frame_rate_den="1000" colorspace="709"/>`,
		...producers,
		mainBin,
		blackTrack,
		...playlists,
		tractor,
		"</mlt>",
	];

	return {
		xml: `${documentParts.join("\n")}\n`,
		guides,
		warnings,
		segmentCount: segments.length,
	};
}
