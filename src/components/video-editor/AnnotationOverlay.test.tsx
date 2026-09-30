import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationOverlay } from "./AnnotationOverlay";
import {
	type AnnotationRegion,
	type AnnotationType,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_RECTANGLE_FIGURE_DATA,
} from "./types";

afterEach(cleanup);

function createAnnotation(type: AnnotationType): AnnotationRegion {
	return {
		id: `${type}-1`,
		startMs: 0,
		endMs: 2_000,
		type,
		content:
			type === "text"
				? "Editable text"
				: type === "image"
					? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
					: "",
		position: { x: 10, y: 10 },
		size: { width: 30, height: 20 },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: 1,
		figureData:
			type === "rectangle"
				? { ...DEFAULT_RECTANGLE_FIGURE_DATA }
				: type === "figure"
					? { ...DEFAULT_FIGURE_DATA }
					: undefined,
	};
}

describe("AnnotationOverlay mouse selection", () => {
	it.each<AnnotationType>([
		"text",
		"rectangle",
		"figure",
		"image",
	])("allows an unselected %s annotation to be clicked", (type) => {
		const onClick = vi.fn();
		const parentPointerDown = vi.fn();
		const parentClick = vi.fn();

		render(
			<div onPointerDown={parentPointerDown} onClick={parentClick}>
				<AnnotationOverlay
					annotation={createAnnotation(type)}
					isSelected={false}
					containerWidth={800}
					containerHeight={450}
					onPositionChange={() => undefined}
					onSizeChange={() => undefined}
					onClick={onClick}
					zIndex={1}
					isSelectedBoost={false}
				/>
			</div>,
		);

		const overlay = screen.getByTestId(`annotation-overlay-${type}-1`);
		expect(overlay.style.pointerEvents).toBe("auto");
		fireEvent.pointerDown(overlay);
		fireEvent.click(overlay);

		expect(onClick).toHaveBeenCalledOnce();
		expect(onClick).toHaveBeenCalledWith(`${type}-1`);
		expect(parentPointerDown).not.toHaveBeenCalled();
		expect(parentClick).not.toHaveBeenCalled();
	});
});
