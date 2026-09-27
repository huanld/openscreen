import { describe, expect, it } from "vitest";
import {
	type AnnotationRegion,
	type AnnotationType,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
} from "../types";
import {
	ANNOTATION_TRACKS,
	annotationLaneRowId,
	annotationRowId,
	firstFreeLane,
	type LaneEntry,
	laneForAnnotation,
	laneHasRoom,
	layoutAnnotationLanes,
	MAX_ANNOTATION_LANES,
	normalizeLane,
	parseAnnotationLaneRowId,
} from "./annotationTracks";

function item(id: string, start: number, end: number, lane?: number): LaneEntry {
	return { id, span: { start, end }, lane };
}

function laneIds(lanes: LaneEntry[][]) {
	return lanes.map((lane) => lane.map((entry) => entry.id));
}

function region(id: string, type: AnnotationType, startMs: number, endMs: number, lane?: number) {
	return {
		id,
		type,
		startMs,
		endMs,
		lane,
		content: "",
		position: DEFAULT_ANNOTATION_POSITION,
		size: DEFAULT_ANNOTATION_SIZE,
		style: DEFAULT_ANNOTATION_STYLE,
		zIndex: 1,
	} satisfies AnnotationRegion;
}

describe("annotation tracks", () => {
	it("gives text, images, arrows and magnifiers separate rows", () => {
		const rows = (["text", "image", "figure", "magnifier"] as const).map(annotationRowId);
		expect(new Set(rows).size).toBe(4);
	});

	it("shows the manually creatable tracks even while they are empty", () => {
		expect(
			ANNOTATION_TRACKS.filter((track) => track.alwaysVisible).map((track) => track.kind),
		).toEqual(["text", "image", "figure"]);
	});

	it("falls back to the text row for a type without a track", () => {
		expect(annotationRowId("blur")).toBe(annotationRowId("text"));
	});

	it("round-trips a lane drop target id back to its row and lane", () => {
		expect(parseAnnotationLaneRowId(annotationLaneRowId("figure", 3))).toEqual({
			kind: "figure",
			lane: 3,
		});
		expect(parseAnnotationLaneRowId("row-zoom")).toBeNull();
		expect(parseAnnotationLaneRowId("row-annotation-text::lane--1")).toBeNull();
	});

	it("only keeps stored lanes that are usable", () => {
		expect(normalizeLane(2)).toBe(2);
		for (const bad of [-1, 1.5, "1", Number.NaN, MAX_ANNOTATION_LANES, undefined]) {
			expect(normalizeLane(bad)).toBeUndefined();
		}
	});
});

describe("automatic lane layout", () => {
	it("keeps items that do not overlap on a single lane", () => {
		expect(
			laneIds(layoutAnnotationLanes([item("b", 2000, 3000), item("a", 0, 1000)]).lanes),
		).toEqual([["a", "b"]]);
	});

	it("lets items that only touch share a lane", () => {
		expect(
			laneIds(layoutAnnotationLanes([item("a", 0, 1000), item("b", 1000, 2000)]).lanes),
		).toEqual([["a", "b"]]);
	});

	it("moves overlapping items onto their own lanes", () => {
		expect(
			laneIds(
				layoutAnnotationLanes([item("a", 0, 3000), item("b", 1000, 2000), item("c", 1500, 4000)])
					.lanes,
			),
		).toEqual([["a"], ["b"], ["c"]]);
	});

	it("reuses the first lane that has freed up rather than opening a new one", () => {
		expect(
			laneIds(
				layoutAnnotationLanes([
					item("long", 0, 5000),
					item("short", 0, 1000),
					item("later", 2000, 3000),
				]).lanes,
			),
		).toEqual([["short", "later"], ["long"]]);
	});

	it("lays out simultaneous items in the same order every time", () => {
		const first = laneIds(layoutAnnotationLanes([item("b", 0, 1000), item("a", 0, 1000)]).lanes);
		const second = laneIds(layoutAnnotationLanes([item("a", 0, 1000), item("b", 0, 1000)]).lanes);
		expect(first).toEqual([["a"], ["b"]]);
		expect(second).toEqual(first);
	});
});

describe("chosen lanes", () => {
	it("keeps an annotation in the lane it was moved to, leaving lanes above it empty", () => {
		const { lanes, laneOf } = layoutAnnotationLanes([item("a", 0, 1000, 2)]);
		expect(laneIds(lanes)).toEqual([[], [], ["a"]]);
		expect(laneOf.get("a")).toBe(2);
	});

	it("fits annotations without a lane around the ones that have one", () => {
		const { laneOf } = layoutAnnotationLanes([
			item("pinned", 0, 2000, 0),
			item("legacy", 500, 1500),
		]);
		expect(laneOf.get("pinned")).toBe(0);
		expect(laneOf.get("legacy")).toBe(1);
	});

	it("never draws two annotations on top of each other, even if both claim the same lane", () => {
		const { laneOf } = layoutAnnotationLanes([item("a", 0, 2000, 1), item("b", 1000, 3000, 1)]);
		expect(laneOf.get("a")).toBe(1);
		expect(laneOf.get("b")).not.toBe(1);
	});

	it("keeps empty lanes the user added", () => {
		expect(layoutAnnotationLanes([item("a", 0, 1000, 0)], 3).lanes).toHaveLength(3);
	});

	it("never places two overlapping items on the same lane", () => {
		const entries = Array.from({ length: 60 }, (_, index) => {
			const start = (index * 7919) % 20000;
			return item(
				`i${index}`,
				start,
				start + 500 + ((index * 104729) % 4000),
				index % 3 === 0 ? index % 4 : undefined,
			);
		});
		for (const lane of layoutAnnotationLanes(entries).lanes) {
			for (let index = 1; index < lane.length; index++) {
				expect(lane[index].span.start).toBeGreaterThanOrEqual(lane[index - 1].span.end);
			}
		}
	});
});

describe("moving between lanes", () => {
	const row = [item("a", 0, 2000, 0), item("b", 3000, 5000, 1)];

	it("allows a move into a lane that is free at that time", () => {
		expect(laneHasRoom(row, 1, { start: 0, end: 2000 }, "a")).toBe(true);
	});

	it("refuses a move that would cover another annotation", () => {
		expect(laneHasRoom(row, 1, { start: 2500, end: 3500 }, "a")).toBe(false);
	});

	it("does not treat the moving annotation as its own obstacle", () => {
		expect(laneHasRoom(row, 0, { start: 500, end: 2500 }, "a")).toBe(true);
	});

	it("treats a lane beyond the last one as empty, so a drop there opens a new lane", () => {
		expect(laneHasRoom(row, 2, { start: 0, end: 5000 }, "a")).toBe(true);
	});

	it("starts a new annotation in the first lane that is free at its time", () => {
		expect(firstFreeLane(row, { start: 1000, end: 1500 })).toBe(1);
		expect(firstFreeLane(row, { start: 2000, end: 3000 })).toBe(0);
	});

	it("gives a duplicate its own lane instead of stacking it on the original", () => {
		const regions = [region("original", "text", 0, 2000, 0)];
		expect(laneForAnnotation(regions, "text", { start: 0, end: 2000 })).toBe(1);
	});

	it("ignores other rows and the annotation's own old lane when it changes type", () => {
		const regions = [
			region("caption", "text", 0, 2000, 3),
			region("other-arrow", "figure", 0, 2000, 0),
		];
		expect(laneForAnnotation(regions, "figure", { start: 0, end: 2000 }, "caption")).toBe(1);
		expect(laneForAnnotation(regions, "image", { start: 0, end: 2000 }, "caption")).toBe(0);
	});
});
