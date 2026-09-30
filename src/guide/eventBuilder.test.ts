import { describe, expect, it } from "vitest";
import { buildGuideEventsFromCursor, mergeGuideEvents, sortGuideEvents } from "./eventBuilder";

describe("buildGuideEventsFromCursor", () => {
	it("converts cursor click samples into guide events", () => {
		const events = buildGuideEventsFromCursor({
			recordingId: 123,
			nowIso: "2026-05-27T00:00:00.000Z",
			samples: [
				{ timeMs: 10, cx: 0.2, cy: 0.3, interactionType: "move" },
				{ timeMs: 20, cx: 0.4, cy: 0.5, interactionType: "click" },
				{ timeMs: 30, cx: 0.4, cy: 0.5, interactionType: "mouseup" },
			],
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			recordingId: "123",
			kind: "click",
			source: "cursor-recording",
			timeMs: 20,
			normalizedX: 0.4,
			normalizedY: 0.5,
			screenshotOffsetMs: 500,
		});
	});

	it("deduplicates click bounce samples close in time and position", () => {
		const events = buildGuideEventsFromCursor({
			recordingId: "abc",
			samples: [
				{ timeMs: 1000, cx: 0.5, cy: 0.5, interactionType: "click" },
				{ timeMs: 1050, cx: 0.501, cy: 0.501, interactionType: "click" },
				{ timeMs: 1500, cx: 0.5, cy: 0.5, interactionType: "click" },
			],
		});

		expect(events.map((event) => event.timeMs)).toEqual([1000, 1500]);
	});

	it("keeps close-timed clicks when positions are meaningfully different", () => {
		const events = buildGuideEventsFromCursor({
			recordingId: "abc",
			samples: [
				{ timeMs: 1000, cx: 0.2, cy: 0.2, interactionType: "click" },
				{ timeMs: 1050, cx: 0.8, cy: 0.8, interactionType: "click" },
			],
		});

		expect(events).toHaveLength(2);
	});

	it("sorts guide events by timestamp", () => {
		expect(
			sortGuideEvents([
				{
					id: "2",
					recordingId: "r",
					kind: "manual",
					source: "review-ui",
					timeMs: 200,
					createdAt: "now",
				},
				{
					id: "1",
					recordingId: "r",
					kind: "manual",
					source: "review-ui",
					timeMs: 100,
					createdAt: "now",
				},
			]).map((event) => event.id),
		).toEqual(["1", "2"]);
	});

	it("merges cursor and manual events without dropping manual markers", () => {
		const events = mergeGuideEvents([
			{
				id: "manual",
				recordingId: "r",
				kind: "manual",
				source: "review-ui",
				timeMs: 120,
				createdAt: "now",
			},
			{
				id: "click-1",
				recordingId: "r",
				kind: "click",
				source: "cursor-recording",
				timeMs: 100,
				normalizedX: 0.5,
				normalizedY: 0.5,
				createdAt: "now",
			},
			{
				id: "click-2",
				recordingId: "r",
				kind: "click",
				source: "cursor-recording",
				timeMs: 150,
				normalizedX: 0.5,
				normalizedY: 0.5,
				createdAt: "now",
			},
		]);

		expect(events.map((event) => event.id)).toEqual(["click-1", "manual"]);
	});
});
