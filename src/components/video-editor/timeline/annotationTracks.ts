import type { Span } from "dnd-timeline";
import type { AnnotationRegion, AnnotationType } from "../types";

/** Blur regions have a timeline row of their own and never reach these tracks. */
export type AnnotationTrackKind = Exclude<AnnotationType, "blur">;

export interface AnnotationTrack {
	kind: AnnotationTrackKind;
	rowId: string;
	hintKey: string;
	alwaysVisible: boolean;
}

/** One timeline row per annotation type, in display order. */
export const ANNOTATION_TRACKS: readonly AnnotationTrack[] = [
	{ kind: "text", rowId: "row-annotation-text", hintKey: "hints.textTrack", alwaysVisible: true },
	{
		kind: "image",
		rowId: "row-annotation-image",
		hintKey: "hints.imageTrack",
		alwaysVisible: true,
	},
	{
		kind: "figure",
		rowId: "row-annotation-figure",
		hintKey: "hints.figureTrack",
		alwaysVisible: true,
	},
	{
		kind: "rectangle",
		rowId: "row-annotation-rectangle",
		hintKey: "hints.rectangleTrack",
		alwaysVisible: true,
	},
];

/** Keeps a damaged or hand-edited project from asking for an absurd number of lanes. */
export const MAX_ANNOTATION_LANES = 32;

export function isAnnotationTrackKind(type: AnnotationType): type is AnnotationTrackKind {
	return ANNOTATION_TRACKS.some((track) => track.kind === type);
}

export function annotationRowId(type: AnnotationType): string {
	return (
		ANNOTATION_TRACKS.find((track) => track.kind === type)?.rowId ?? ANNOTATION_TRACKS[0].rowId
	);
}

const LANE_SEPARATOR = "::lane-";

/** Each lane is its own drop target, so a drag reports which lane it ended over. */
export function annotationLaneRowId(kind: AnnotationTrackKind, lane: number): string {
	return `${annotationRowId(kind)}${LANE_SEPARATOR}${lane}`;
}

export function parseAnnotationLaneRowId(
	rowId: string,
): { kind: AnnotationTrackKind; lane: number } | null {
	const separator = rowId.lastIndexOf(LANE_SEPARATOR);
	if (separator < 0) return null;
	const track = ANNOTATION_TRACKS.find(
		(candidate) => candidate.rowId === rowId.slice(0, separator),
	);
	const lane = Number(rowId.slice(separator + LANE_SEPARATOR.length));
	if (!track || !Number.isInteger(lane) || lane < 0) return null;
	return { kind: track.kind, lane };
}

/** A stored lane, or undefined when the value is missing or unusable. */
export function normalizeLane(value: unknown): number | undefined {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value < MAX_ANNOTATION_LANES
		? value
		: undefined;
}

export interface LaneEntry {
	id: string;
	span: Span;
	lane?: number;
}

export function toLaneEntry(region: Pick<AnnotationRegion, "id" | "startMs" | "endMs" | "lane">) {
	return { id: region.id, span: { start: region.startMs, end: region.endMs }, lane: region.lane };
}

function spansOverlap(a: Span, b: Span) {
	return a.start < b.end && b.start < a.end;
}

function byStart(a: LaneEntry, b: LaneEntry) {
	return a.span.start - b.span.start || a.span.end - b.span.end || a.id.localeCompare(b.id);
}

export interface LaneLayout<T extends LaneEntry> {
	lanes: T[][];
	laneOf: Map<string, number>;
}

/**
 * Resolves the lane every item is drawn in. An item keeps the lane it was given
 * while that lane is free at its time. Items without a lane - old projects and
 * guide-generated annotations - and items whose lane is already taken go to the
 * first lane where they fit, which keeps them from ever drawing on top of each
 * other. The row always has at least `minLaneCount` lanes, so lanes the user
 * added stay visible while still empty.
 */
export function layoutAnnotationLanes<T extends LaneEntry>(
	items: readonly T[],
	minLaneCount = 0,
): LaneLayout<T> {
	const lanes: T[][] = [];
	const laneOf = new Map<string, number>();
	const fits = (lane: number, item: T) =>
		!(lanes[lane] ?? []).some((other) => spansOverlap(other.span, item.span));
	const place = (lane: number, item: T) => {
		while (lanes.length <= lane) lanes.push([]);
		lanes[lane].push(item);
		laneOf.set(item.id, lane);
	};

	const unplaced: T[] = [];
	for (const item of [...items].sort(byStart)) {
		const lane = normalizeLane(item.lane);
		if (lane !== undefined && fits(lane, item)) place(lane, item);
		else unplaced.push(item);
	}
	for (const item of unplaced) {
		let lane = 0;
		while (!fits(lane, item)) lane++;
		place(lane, item);
	}

	while (lanes.length < Math.min(minLaneCount, MAX_ANNOTATION_LANES)) lanes.push([]);
	for (const lane of lanes) lane.sort(byStart);
	return { lanes, laneOf };
}

/** Whether `span` fits in `lane` without covering any annotation other than `movingId`. */
export function laneHasRoom(
	items: readonly LaneEntry[],
	lane: number,
	span: Span,
	movingId?: string,
): boolean {
	const { lanes } = layoutAnnotationLanes(items);
	return !(lanes[lane] ?? []).some(
		(other) => other.id !== movingId && spansOverlap(other.span, span),
	);
}

/** The first lane a new annotation at `span` fits in, next to the existing items. */
export function firstFreeLane(items: readonly LaneEntry[], span: Span): number {
	const { lanes } = layoutAnnotationLanes(items);
	let lane = 0;
	while ((lanes[lane] ?? []).some((other) => spansOverlap(other.span, span))) lane++;
	return lane;
}

/**
 * Lane for an annotation entering the `kind` row: newly added, duplicated, or
 * switched to a different type. The lane it had in another row means nothing
 * here, so it takes the first lane that is free at its time.
 */
export function laneForAnnotation(
	regions: readonly AnnotationRegion[],
	kind: AnnotationTrackKind,
	span: Span,
	excludeId?: string,
): number {
	return firstFreeLane(
		regions.filter((region) => region.type === kind && region.id !== excludeId).map(toLaneEntry),
		span,
	);
}
