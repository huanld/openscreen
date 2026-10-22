import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Range } from "dnd-timeline";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineScrollbar } from "./TimelineEditor";

afterEach(cleanup);

function ScrollbarHarness({ initialRange }: { initialRange: Range }) {
	const [range, setRange] = useState(initialRange);
	return (
		<>
			<output data-testid="visible-range">
				{range.start}:{range.end}
			</output>
			<TimelineScrollbar
				visibleStart={range.start}
				visibleEnd={range.end}
				totalMs={10_000}
				onRangeChange={setRange}
			/>
		</>
	);
}

describe("TimelineScrollbar", () => {
	it("shows controls at both ends and pans in both directions", () => {
		render(<ScrollbarHarness initialRange={{ start: 3_000, end: 7_000 }} />);

		expect(screen.getByTestId("timeline-horizontal-scrollbar")).toBeTruthy();
		fireEvent.click(screen.getByTestId("timeline-scroll-left"));
		expect(screen.getByTestId("visible-range").textContent).toBe("2200:6200");

		fireEvent.click(screen.getByTestId("timeline-scroll-right"));
		expect(screen.getByTestId("visible-range").textContent).toBe("3000:7000");
	});

	it("disables navigation after reaching either edge", () => {
		const { rerender } = render(
			<ScrollbarHarness key="left-edge" initialRange={{ start: 0, end: 4_000 }} />,
		);
		expect((screen.getByTestId("timeline-scroll-left") as HTMLButtonElement).disabled).toBe(true);

		rerender(<ScrollbarHarness key="right-edge" initialRange={{ start: 6_000, end: 10_000 }} />);
		expect((screen.getByTestId("timeline-scroll-right") as HTMLButtonElement).disabled).toBe(true);
	});

	it("supports zooming in, zooming out, and fitting to 100%", () => {
		render(<ScrollbarHarness initialRange={{ start: 0, end: 10_000 }} />);

		// At 100%, zoom out and fit are disabled
		expect((screen.getByTestId("timeline-zoom-out") as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByTestId("timeline-zoom-fit") as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByTestId("timeline-zoom-fit").textContent).toBe("100%");

		// Click zoom in
		fireEvent.click(screen.getByTestId("timeline-zoom-in"));
		expect(screen.getByTestId("visible-range").textContent).toBe("1500:8500");
		expect((screen.getByTestId("timeline-zoom-out") as HTMLButtonElement).disabled).toBe(false);

		// Click fit to reset
		fireEvent.click(screen.getByTestId("timeline-zoom-fit"));
		expect(screen.getByTestId("visible-range").textContent).toBe("0:10000");
		expect(screen.getByTestId("timeline-zoom-fit").textContent).toBe("100%");
	});
});
