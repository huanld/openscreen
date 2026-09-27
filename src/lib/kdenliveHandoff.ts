const DEFAULT_FRAME_RATE = 60;
const MEDIA_REFERENCE_KEY = "DEFAULT_MEDIA";
const MAX_TIMED_REGIONS = 10_000;

interface TimedRegion {
	id: string;
	startMs: number;
	endMs: number;
}

interface SpeedTimedRegion extends TimedRegion {
	speed: number;
}

interface ZoomTimedRegion extends TimedRegion {
	depth?: number;
	customScale?: number;
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
	trimRegions?: readonly TimedRegion[];
	speedRegions?: readonly SpeedTimedRegion[];
	zoomRegions?: readonly ZoomTimedRegion[];
	annotationRegions?: readonly AnnotationTimedRegion[];
}

interface OtioRationalTime {
	OTIO_SCHEMA: "RationalTime.1";
	rate: number;
	value: number;
}

interface OtioTimeRange {
	OTIO_SCHEMA: "TimeRange.1";
	duration: OtioRationalTime;
	start_time: OtioRationalTime;
}

interface OtioMarker {
	OTIO_SCHEMA: "Marker.2";
	metadata: Record<string, unknown>;
	name: string;
	color: string;
	marked_range: OtioTimeRange;
	comment: string;
}

interface OtioClip {
	OTIO_SCHEMA: "Clip.2";
	metadata: Record<string, unknown>;
	name: string;
	source_range: OtioTimeRange;
	effects: Array<Record<string, unknown>>;
	markers: OtioMarker[];
	enabled: boolean;
	color: null;
	media_references: Record<string, Record<string, unknown>>;
	active_media_reference_key: typeof MEDIA_REFERENCE_KEY;
}

interface OtioTrack {
	OTIO_SCHEMA: "Track.1";
	metadata: Record<string, unknown>;
	name: string;
	source_range: null;
	effects: Array<Record<string, unknown>>;
	markers: OtioMarker[];
	enabled: boolean;
	color: null;
	children: OtioClip[];
	kind: "Video" | "Audio";
}

export interface KdenliveHandoffTimeline {
	OTIO_SCHEMA: "Timeline.1";
	metadata: Record<string, unknown>;
	name: string;
	global_start_time: null;
	tracks: {
		OTIO_SCHEMA: "Stack.1";
		metadata: Record<string, unknown>;
		name: string;
		source_range: null;
		effects: Array<Record<string, unknown>>;
		markers: OtioMarker[];
		enabled: boolean;
		color: null;
		children: OtioTrack[];
	};
}

export interface KdenliveHandoffResult {
	timeline: KdenliveHandoffTimeline;
	json: string;
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

interface TimelineRange extends FrameRange {
	timelineStart: number;
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

function rationalTime(value: number, rate: number): OtioRationalTime {
	return {
		OTIO_SCHEMA: "RationalTime.1",
		rate,
		value,
	};
}

function timeRange(start: number, duration: number, rate: number): OtioTimeRange {
	return {
		OTIO_SCHEMA: "TimeRange.1",
		duration: rationalTime(duration, rate),
		start_time: rationalTime(start, rate),
	};
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

function toTimelineRanges(keptRanges: readonly FrameRange[]): TimelineRange[] {
	let timelineStart = 0;
	return keptRanges.map((range) => {
		const timelineRange = { ...range, timelineStart };
		timelineStart += range.end - range.start;
		return timelineRange;
	});
}

function markerPosition(
	region: TimedRegion,
	frameRate: number,
	totalFrames: number,
	timelineRanges: readonly TimelineRange[],
) {
	const start = msToFrame(Math.min(region.startMs, region.endMs), frameRate, totalFrames);
	const end = msToFrame(Math.max(region.startMs, region.endMs), frameRate, totalFrames);
	const containingRange = timelineRanges.find((range) => end > range.start && start < range.end);
	if (!containingRange) return null;
	const sourcePosition = Math.max(start, containingRange.start);
	return containingRange.timelineStart + sourcePosition - containingRange.start;
}

function truncateMarkerText(value: string | undefined) {
	if (!value) return "";
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function buildMarker(
	name: string,
	comment: string,
	color: string,
	position: number,
	frameRate: number,
	metadata: Record<string, unknown>,
): OtioMarker {
	return {
		OTIO_SCHEMA: "Marker.2",
		metadata: { openscreen: metadata },
		name,
		color,
		marked_range: timeRange(position, 1, frameRate),
		comment,
	};
}

function buildTimelineMarkers(
	input: KdenliveHandoffInput,
	frameRate: number,
	totalFrames: number,
	timelineRanges: readonly TimelineRange[],
) {
	const markers: OtioMarker[] = [];
	for (const region of input.zoomRegions ?? []) {
		const position = markerPosition(region, frameRate, totalFrames, timelineRanges);
		if (position === null) continue;
		const scale = region.customScale ?? (region.depth ? `preset ${region.depth}` : undefined);
		markers.push(
			buildMarker(
				"OpenScreen zoom",
				`OpenScreen zoom${scale ? ` (${scale})` : ""}`,
				"CYAN",
				position,
				frameRate,
				{ id: region.id, type: "zoom", start_ms: region.startMs, end_ms: region.endMs },
			),
		);
	}

	for (const region of input.speedRegions ?? []) {
		const position = markerPosition(region, frameRate, totalFrames, timelineRanges);
		if (position === null) continue;
		markers.push(
			buildMarker(
				"OpenScreen speed",
				`OpenScreen speed ${region.speed}x`,
				"ORANGE",
				position,
				frameRate,
				{
					id: region.id,
					type: "speed",
					speed: region.speed,
					start_ms: region.startMs,
					end_ms: region.endMs,
				},
			),
		);
	}

	for (const region of input.annotationRegions ?? []) {
		const position = markerPosition(region, frameRate, totalFrames, timelineRanges);
		if (position === null) continue;
		const content = truncateMarkerText(region.textContent || region.content);
		const label = region.type === "blur" ? "blur" : `annotation (${region.type})`;
		markers.push(
			buildMarker(
				`OpenScreen ${label}`,
				`OpenScreen ${label}${content ? `: ${content}` : ""}`,
				region.type === "blur" ? "PURPLE" : "GREEN",
				position,
				frameRate,
				{
					id: region.id,
					type: region.type,
					start_ms: region.startMs,
					end_ms: region.endMs,
				},
			),
		);
	}

	return markers.sort((a, b) => a.marked_range.start_time.value - b.marked_range.start_time.value);
}

/**
 * Kdenlive's native OTIO exporter writes local media as filesystem paths.
 * Keep that convention so its importer can resolve Windows drive and UNC paths.
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

function externalReference(sourcePath: string, totalFrames: number, frameRate: number) {
	return {
		OTIO_SCHEMA: "ExternalReference.1",
		metadata: {},
		name: "",
		available_range: timeRange(0, totalFrames, frameRate),
		available_image_bounds: null,
		target_url: normalizeKdenliveMediaPath(sourcePath),
	};
}

function buildTrack(
	name: string,
	kind: "Video" | "Audio",
	sourcePath: string,
	segments: readonly HandoffSegment[],
	totalFrames: number,
	frameRate: number,
): OtioTrack {
	const children = segments.map((segment, index): OtioClip => {
		const duration = segment.end - segment.start;
		const effects: Array<Record<string, unknown>> = [];
		if (segment.speed !== 1) {
			effects.push({
				OTIO_SCHEMA: "LinearTimeWarp.1",
				metadata: {
					openscreen: {
						...(segment.speedRegionId ? { region_id: segment.speedRegionId } : {}),
					},
				},
				name: `OpenScreen speed ${segment.speed}x`,
				effect_name: "LinearTimeWarp",
				enabled: true,
				time_scalar: segment.speed,
			});
		}

		return {
			OTIO_SCHEMA: "Clip.2",
			metadata: {
				openscreen: {
					source_start_frame: segment.start,
					source_end_frame: segment.end,
					playback_speed: segment.speed,
					...(segment.speedRegionId ? { speed_region_id: segment.speedRegionId } : {}),
				},
			},
			name: `${name} ${index + 1}`,
			source_range: timeRange(segment.start, duration, frameRate),
			effects,
			markers: [],
			enabled: true,
			color: null,
			media_references: {
				[MEDIA_REFERENCE_KEY]: externalReference(sourcePath, totalFrames, frameRate),
			},
			active_media_reference_key: MEDIA_REFERENCE_KEY,
		};
	});

	return {
		OTIO_SCHEMA: "Track.1",
		metadata: { openscreen: { role: kind === "Audio" ? "screen_audio" : name.toLowerCase() } },
		name,
		source_range: null,
		effects: [],
		markers: [],
		enabled: true,
		color: null,
		children,
		kind,
	};
}

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
	const tracks = [
		buildTrack("Screen Video", "Video", input.screenSourcePath, segments, totalFrames, frameRate),
		buildTrack("Screen Audio", "Audio", input.screenSourcePath, segments, totalFrames, frameRate),
	];
	if (input.webcamSourcePath) {
		tracks.splice(
			1,
			0,
			buildTrack("Webcam", "Video", input.webcamSourcePath, segments, totalFrames, frameRate),
		);
	}

	const warnings = [
		"OpenScreen visual effects are represented as markers and metadata; Kdenlive does not recreate them from OTIO.",
	];
	if (normalizedSpeedRegions.some((region) => region.speed !== 1)) {
		warnings.push(
			"Speed regions use OTIO LinearTimeWarp and markers; Kdenlive's native OTIO importer may ignore the time-warp effect.",
		);
	}
	if (input.webcamSourcePath) {
		warnings.push(
			"The webcam is a separate full-frame video track; its OpenScreen layout and mask must be recreated in Kdenlive.",
		);
	}

	const timelineRanges = toTimelineRanges(kept);
	const timeline: KdenliveHandoffTimeline = {
		OTIO_SCHEMA: "Timeline.1",
		metadata: {
			openscreen: {
				format_version: 1,
				handoff_target: "kdenlive",
				source_duration_ms: input.durationMs,
				frame_rate: frameRate,
				trim_semantics: "removed_ranges",
				compatibility: {
					media: "external_references",
					cuts: "editable_clips",
					audio: "separate_track",
					speed: "otio_linear_time_warp_and_marker",
					visual_effects: "markers_and_metadata_only",
					webcam: input.webcamSourcePath ? "separate_video_track" : "not_present",
				},
				warnings,
			},
		},
		name: input.name.trim() || "OpenScreen handoff",
		global_start_time: null,
		tracks: {
			OTIO_SCHEMA: "Stack.1",
			metadata: {},
			name: "tracks",
			source_range: null,
			effects: [],
			markers: buildTimelineMarkers(input, frameRate, totalFrames, timelineRanges),
			enabled: true,
			color: null,
			children: tracks,
		},
	};

	return {
		timeline,
		json: `${JSON.stringify(timeline, null, 2)}\n`,
		warnings,
		segmentCount: segments.length,
	};
}
