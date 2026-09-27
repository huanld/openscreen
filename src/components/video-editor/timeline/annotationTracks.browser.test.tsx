import { cleanup, render } from "@testing-library/react";
import type { Span } from "dnd-timeline";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import {
	type AnnotationRegion,
	type AnnotationType,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
} from "../types";
import TimelineEditor from "./TimelineEditor";
// Load the app's Tailwind build so rows, toolbar and timeline lay out as they do
// in the editor. Without it the toolbar is not a single row and grows when the
// lane controls appear, shifting every lane mid-drag.
import "@/index.css";

afterEach(cleanup);

// The timeline scrubber captures the pointer; a synthetic pointerId is not a real
// pointer, so the browser would reject the capture and abort the gesture.
beforeAll(() => {
	Element.prototype.setPointerCapture = () => undefined;
	Element.prototype.releasePointerCapture = () => undefined;
	Element.prototype.hasPointerCapture = () => false;
});

function annotation(
	id: string,
	type: AnnotationType,
	startMs: number,
	endMs: number,
	lane?: number,
): AnnotationRegion {
	return {
		id,
		startMs,
		endMs,
		type,
		lane,
		content: type === "text" ? id : "",
		position: DEFAULT_ANNOTATION_POSITION,
		size: DEFAULT_ANNOTATION_SIZE,
		style: DEFAULT_ANNOTATION_STYLE,
		zIndex: 1,
		figureData:
			type === "figure" ? { arrowDirection: "right", color: "#ff0000", strokeWidth: 4 } : undefined,
	};
}

// What the guide produces for a single event: a caption, an arrow and a
// magnifier together, plus a second caption that overlaps the first.
const REGIONS = [
	annotation("caption-1", "text", 1000, 4000),
	annotation("caption-2", "text", 2000, 5000),
	annotation("screenshot", "image", 1500, 3500),
	annotation("pointer", "figure", 1000, 4000),
	annotation("zoom-lens", "magnifier", 1000, 4000),
];

type Placement = { id: string; span: Span; lane: number };

/** Holds regions and selection the way the editor does, so changes re-render. */
function EditableTimeline({
	initial,
	onPlacement = () => undefined,
	initialSelection = null,
}: {
	initial: AnnotationRegion[];
	onPlacement?: (placement: Placement) => void;
	initialSelection?: string | null;
}) {
	const [regions, setRegions] = useState(initial);
	const [selected, setSelected] = useState<string | null>(initialSelection);
	return (
		<div style={{ width: 1200, height: 900, display: "flex" }}>
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={0}
						onSeek={() => undefined}
						zoomRegions={[]}
						onZoomAdded={() => undefined}
						onZoomSpanChange={() => undefined}
						onZoomDelete={() => undefined}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						aspectRatio="16:9"
						onAspectRatioChange={() => undefined}
						annotationRegions={regions}
						selectedAnnotationId={selected}
						onSelectAnnotation={setSelected}
						onAnnotationPlacementChange={(id, span, lane) => {
							onPlacement({ id, span, lane });
							setRegions((previous) =>
								previous.map((region) =>
									region.id === id
										? { ...region, startMs: span.start, endMs: span.end, lane }
										: region,
								),
							);
						}}
					/>
				</ShortcutsProvider>
			</I18nProvider>
		</div>
	);
}

function itemElement(id: string) {
	const element = document.querySelector<HTMLElement>(`[data-timeline-item-id="${id}"]`);
	if (!element) throw new Error(`Timeline item ${id} did not render.`);
	return element;
}

function laneOf(id: string) {
	const lane = itemElement(id).closest<HTMLElement>("[data-annotation-lane]");
	if (!lane) throw new Error(`Timeline item ${id} is not inside an annotation lane.`);
	return lane;
}

function laneIndexOf(id: string) {
	return Number(laneOf(id).dataset.laneIndex);
}

function lanesOf(kind: string) {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			`[data-annotation-track="${kind}"] [data-annotation-lane]:not([data-new-lane])`,
		),
	);
}

function overlaps(a: DOMRect, b: DOMRect) {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function centerY(element: Element) {
	const rect = element.getBoundingClientRect();
	return rect.top + rect.height / 2;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/** Presses the middle of an item (its ends are resize handles) and drags it vertically. */
async function dragVertically(id: string, targetCenterY: () => number) {
	// Until dnd-timeline has measured the timeline an item is 0px wide, and a press
	// within 10px of its edge starts a resize instead of a drag.
	await vi.waitFor(
		() => expect(itemElement(id).getBoundingClientRect().width).toBeGreaterThan(40),
		{
			timeout: 10_000,
		},
	);
	const rect = itemElement(id).getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const startY = rect.top + rect.height / 2;
	const pointer = (y: number, buttons: number) => ({
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		isPrimary: true,
		pointerType: "mouse",
		button: 0,
		buttons,
		clientX: x,
		clientY: y,
	});
	itemElement(id).dispatchEvent(new PointerEvent("pointerdown", pointer(startY, 1)));
	await nextFrame();
	// Nudge first so the drag starts and the row offers its extra lane, then aim
	// at the target, which may only exist once the drag is under way.
	document.dispatchEvent(new PointerEvent("pointermove", pointer(startY + 4, 1)));
	await nextFrame();
	await nextFrame();
	const endY = targetCenterY();
	for (let step = 1; step <= 6; step++) {
		document.dispatchEvent(
			new PointerEvent("pointermove", pointer(startY + ((endY - startY) * step) / 6, 1)),
		);
		await nextFrame();
	}
	document.dispatchEvent(new PointerEvent("pointerup", pointer(endY, 0)));
	await nextFrame();
	// After a drop dnd-kit swallows clicks for 50 ms so the release is not read as a
	// click. A person cannot click that fast; a test can, so let the window pass.
	await new Promise((resolve) => setTimeout(resolve, 80));
}

describe("annotation timeline tracks (real layout)", () => {
	it("puts each annotation type on its own row", async () => {
		render(<EditableTimeline initial={REGIONS} />);
		await vi.waitFor(() => itemElement("zoom-lens"), { timeout: 10_000 });

		expect(laneOf("caption-1").dataset.annotationLane).toBe("text");
		expect(laneOf("caption-2").dataset.annotationLane).toBe("text");
		expect(laneOf("screenshot").dataset.annotationLane).toBe("image");
		expect(laneOf("pointer").dataset.annotationLane).toBe("figure");
		expect(laneOf("zoom-lens").dataset.annotationLane).toBe("magnifier");
	});

	it("stacks annotations of the same type that overlap in time onto separate lanes", async () => {
		render(<EditableTimeline initial={REGIONS} />);
		await vi.waitFor(() => itemElement("caption-2"), { timeout: 10_000 });
		expect(laneOf("caption-1")).not.toBe(laneOf("caption-2"));
	});

	it("draws no annotation on top of another", async () => {
		render(<EditableTimeline initial={REGIONS} />);
		await vi.waitFor(() => itemElement("zoom-lens"), { timeout: 10_000 });

		const ids = REGIONS.map((region) => region.id);
		// Wait for dnd-timeline to measure the timeline and give items real widths.
		await vi.waitFor(() => {
			for (const id of ids)
				expect(itemElement(id).getBoundingClientRect().width).toBeGreaterThan(20);
		});
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = itemElement(ids[i]).getBoundingClientRect();
				const b = itemElement(ids[j]).getBoundingClientRect();
				expect(overlaps(a, b), `${ids[i]} overlaps ${ids[j]}`).toBe(false);
			}
		}
	});

	it("hides the magnifier row until the guide has produced a magnifier", async () => {
		render(<EditableTimeline initial={REGIONS.filter((region) => region.type !== "magnifier")} />);
		await vi.waitFor(() => itemElement("pointer"), { timeout: 10_000 });
		expect(document.querySelector('[data-annotation-lane="magnifier"]')).toBeNull();
	});
});

describe("moving annotations between lanes (real drag)", () => {
	it("draws an annotation in the lane it was saved in", async () => {
		render(<EditableTimeline initial={[annotation("pinned", "text", 1000, 3000, 2)]} />);
		await vi.waitFor(() => itemElement("pinned"), { timeout: 10_000 });
		expect(laneIndexOf("pinned")).toBe(2);
		expect(lanesOf("text")).toHaveLength(3);
	});

	it("moves an annotation to another lane of its row when dropped there", async () => {
		const placements: Placement[] = [];
		render(
			<EditableTimeline
				initial={[
					annotation("first", "text", 1000, 3000, 0),
					annotation("second", "text", 5000, 7000, 1),
				]}
				onPlacement={(placement) => placements.push(placement)}
			/>,
		);
		await vi.waitFor(() => itemElement("first"), { timeout: 10_000 });

		await dragVertically("first", () => centerY(lanesOf("text")[1]));

		await vi.waitFor(() => expect(laneIndexOf("first")).toBe(1));
		expect(placements.at(-1)).toMatchObject({ id: "first", lane: 1 });
	});

	it("offers an extra lane while dragging and creates it on drop", async () => {
		const placements: Placement[] = [];
		render(
			<EditableTimeline
				initial={[annotation("only", "text", 1000, 3000, 0)]}
				onPlacement={(placement) => placements.push(placement)}
			/>,
		);
		await vi.waitFor(() => itemElement("only"), { timeout: 10_000 });
		expect(lanesOf("text")).toHaveLength(1);

		await dragVertically("only", () => {
			const offered = document.querySelector('[data-annotation-track="text"] [data-new-lane]');
			if (!offered) throw new Error("No new lane was offered during the drag.");
			return centerY(offered);
		});

		await vi.waitFor(() => expect(laneIndexOf("only")).toBe(1));
		expect(placements.at(-1)).toMatchObject({ id: "only", lane: 1 });
		expect(document.querySelector("[data-new-lane]")).toBeNull();
	});

	it("refuses a drop that would cover another annotation in that lane", async () => {
		const placements: Placement[] = [];
		render(
			<EditableTimeline
				initial={[
					annotation("mover", "text", 1000, 3000, 0),
					annotation("blocker", "text", 2000, 4000, 1),
				]}
				onPlacement={(placement) => placements.push(placement)}
			/>,
		);
		await vi.waitFor(() => itemElement("mover"), { timeout: 10_000 });

		await dragVertically("mover", () => centerY(lanesOf("text")[1]));

		await nextFrame();
		expect(placements).toEqual([]);
		expect(laneIndexOf("mover")).toBe(0);
	});

	it("keeps an annotation in its own row when it is dropped over another type's row", async () => {
		render(
			<EditableTimeline
				initial={[
					annotation("caption", "text", 1000, 3000, 0),
					annotation("arrow", "figure", 6000, 8000, 0),
				]}
			/>,
		);
		await vi.waitFor(() => itemElement("caption"), { timeout: 10_000 });

		await dragVertically("caption", () => centerY(lanesOf("figure")[0]));

		await nextFrame();
		expect(laneOf("caption").dataset.annotationLane).toBe("text");
	});
});

describe("changing the number of lanes", () => {
	function laneButton(action: "add" | "remove") {
		const button = document.querySelector<HTMLButtonElement>(
			`[data-testid="annotation-lane-${action}"]`,
		);
		if (!button) throw new Error("The lane controls are not shown.");
		return button;
	}

	it("shows the lane controls only while an annotation is selected", async () => {
		render(<EditableTimeline initial={[annotation("caption", "text", 1000, 3000, 0)]} />);
		await vi.waitFor(() => itemElement("caption"), { timeout: 10_000 });
		expect(document.querySelector('[data-testid="annotation-lane-controls"]')).toBeNull();
	});

	it("adds empty lanes and removes them again", async () => {
		render(
			<EditableTimeline
				initial={[annotation("caption", "text", 1000, 3000, 0)]}
				initialSelection="caption"
			/>,
		);
		await vi.waitFor(() => laneButton("add"), { timeout: 10_000 });

		laneButton("add").click();
		await vi.waitFor(() => expect(lanesOf("text")).toHaveLength(2));
		laneButton("add").click();
		await vi.waitFor(() => expect(lanesOf("text")).toHaveLength(3));

		laneButton("remove").click();
		await vi.waitFor(() => expect(lanesOf("text")).toHaveLength(2));
		expect(laneIndexOf("caption")).toBe(0);
	});

	it("will not remove a lane that still holds an annotation", async () => {
		render(
			<EditableTimeline
				initial={[annotation("low", "text", 1000, 3000, 1)]}
				initialSelection="low"
			/>,
		);
		await vi.waitFor(() => laneButton("remove"), { timeout: 10_000 });
		expect(lanesOf("text")).toHaveLength(2);

		laneButton("remove").click();
		await nextFrame();
		expect(lanesOf("text")).toHaveLength(2);
		expect(laneIndexOf("low")).toBe(1);
	});
});
