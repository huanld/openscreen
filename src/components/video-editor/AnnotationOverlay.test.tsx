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
		"pen",
		"redact",
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

	it("zooms a selected rectangle with the mouse wheel", () => {
		const onFigureDataChange = vi.fn();
		const rectangle = createAnnotation("rectangle");

		render(
			<AnnotationOverlay
				annotation={rectangle}
				isSelected
				containerWidth={800}
				containerHeight={450}
				onPositionChange={() => undefined}
				onSizeChange={() => undefined}
				onFigureDataChange={onFigureDataChange}
				onClick={() => undefined}
				zIndex={1}
				isSelectedBoost
			/>,
		);

		fireEvent.wheel(screen.getByTestId("annotation-overlay-rectangle-1"), { deltaY: -100 });

		expect(onFigureDataChange).toHaveBeenCalledWith(
			"rectangle-1",
			expect.objectContaining({ spotlightZoom: 1.8 }),
		);
	});

	it("does not turn the release after a drag into another selection click", () => {
		const onClick = vi.fn();

		render(
			<div style={{ width: 800, height: 450, position: "relative" }}>
				<AnnotationOverlay
					annotation={createAnnotation("text")}
					isSelected
					containerWidth={800}
					containerHeight={450}
					onPositionChange={() => undefined}
					onSizeChange={() => undefined}
					onClick={onClick}
					zIndex={1}
					isSelectedBoost
				/>
			</div>,
		);

		const overlay = screen.getByTestId("annotation-overlay-text-1");
		fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });
		fireEvent.mouseMove(document, { clientX: 140, clientY: 125, buttons: 1 });
		fireEvent.mouseUp(document, { clientX: 140, clientY: 125, button: 0 });
		fireEvent.click(overlay);
		expect(onClick).not.toHaveBeenCalled();

		fireEvent.pointerDown(overlay);
		fireEvent.click(overlay);
		expect(onClick).toHaveBeenCalledOnce();
	});

	it.each<AnnotationType>([
		"rectangle",
		"figure",
		"image",
	])("selects and moves an unselected %s annotation in one drag", (type) => {
		const onClick = vi.fn();
		const onPositionChange = vi.fn();

		render(
			<div style={{ width: 800, height: 450, position: "relative" }}>
				<AnnotationOverlay
					annotation={createAnnotation(type)}
					isSelected={false}
					containerWidth={800}
					containerHeight={450}
					onPositionChange={onPositionChange}
					onSizeChange={() => undefined}
					onClick={onClick}
					zIndex={1}
					isSelectedBoost={false}
				/>
			</div>,
		);

		const overlay = screen.getByTestId(`annotation-overlay-${type}-1`);
		fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });
		fireEvent.mouseMove(document, { clientX: 150, clientY: 130, buttons: 1 });
		fireEvent.mouseUp(document, { clientX: 150, clientY: 130, button: 0 });
		fireEvent.click(overlay);

		expect(onClick).toHaveBeenCalledOnce();
		expect(onClick).toHaveBeenCalledWith(`${type}-1`);
		expect(onPositionChange).toHaveBeenCalledWith(
			`${type}-1`,
			expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
		);
	});
});
