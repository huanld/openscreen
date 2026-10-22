import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import TimelineEditor from "./TimelineEditor";

afterEach(cleanup);

describe("TimelineEditor component shortcuts", () => {
	it("edits the selected presentation slide entrance and background", async () => {
		const onBlankSlideAppearanceChange = vi.fn();
		const view = render(
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={2}
						zoomRegions={[]}
						onZoomAdded={() => undefined}
						onZoomSpanChange={() => undefined}
						onZoomDelete={() => undefined}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						blankSlideRegions={[
							{
								id: "blank-slide-1",
								startMs: 1000,
								endMs: 3000,
								backgroundColor: "#f8fafc",
								transitionIn: "fade",
								transitionOut: "fade",
								transitionDurationMs: 450,
							},
						]}
						selectedBlankSlideId="blank-slide-1"
						onBlankSlideAppearanceChange={onBlankSlideAppearanceChange}
						aspectRatio="16:9"
						onAspectRatioChange={() => undefined}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.pointerDown(view.getByRole("button", { name: "Open slide transition settings" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click((await view.findAllByRole("menuitem", { name: "Slide left" }))[0]);
		expect(onBlankSlideAppearanceChange).toHaveBeenCalledWith("blank-slide-1", {
			transitionIn: "slide-left",
		});

		fireEvent.change(view.getByLabelText("Background"), { target: { value: "#123456" } });
		expect(onBlankSlideAppearanceChange).toHaveBeenCalledWith("blank-slide-1", {
			backgroundColor: "#123456",
		});
	});

	it("adds and deletes main-video transform keyframes from the toolbar", () => {
		const onVideoTransformKeyframeAdded = vi.fn();
		const onVideoTransformKeyframeDeleted = vi.fn();
		const onSelectVideoTransformKeyframe = vi.fn();
		const view = render(
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={2}
						zoomRegions={[]}
						onZoomAdded={() => undefined}
						onZoomSpanChange={() => undefined}
						onZoomDelete={() => undefined}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						videoTransformKeyframes={[
							{
								id: "video-keyframe-1",
								timeMs: 1_000,
								position: { x: 0, y: 0 },
								scale: 0.5,
							},
						]}
						selectedVideoTransformKeyframeId="video-keyframe-1"
						onVideoTransformKeyframeAdded={onVideoTransformKeyframeAdded}
						onVideoTransformKeyframeDeleted={onVideoTransformKeyframeDeleted}
						onSelectVideoTransformKeyframe={onSelectVideoTransformKeyframe}
						aspectRatio="16:9"
						onAspectRatioChange={() => undefined}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.click(view.getByRole("button", { name: "Save video size and position here (F)" }));
		expect(onVideoTransformKeyframeAdded).toHaveBeenCalledWith(2_000);

		fireEvent.click(view.getByRole("button", { name: "Delete selected video keyframe" }));
		expect(onVideoTransformKeyframeDeleted).toHaveBeenCalledWith("video-keyframe-1");
		expect(onSelectVideoTransformKeyframe).toHaveBeenCalledWith(null);
	});

	it("adds a blank slide from the timeline toolbar", () => {
		const onBlankSlideAdded = vi.fn();
		const view = render(
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={2}
						zoomRegions={[]}
						onZoomAdded={() => undefined}
						onZoomSpanChange={() => undefined}
						onZoomDelete={() => undefined}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						blankSlideRegions={[]}
						onBlankSlideAdded={onBlankSlideAdded}
						aspectRatio="16:9"
						onAspectRatioChange={() => undefined}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.click(view.getByRole("button", { name: "Add blank slide" }));
		expect(onBlankSlideAdded).toHaveBeenCalledWith({ start: 2000, end: 3000 });
	});

	it("creates text, rectangle, arrow, and requests an image with the default keys", () => {
		const onAnnotationAdded = vi.fn();
		const onRectangleAdded = vi.fn();
		const onArrowAdded = vi.fn();
		const onImageAddRequested = vi.fn();

		render(
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={2}
						zoomRegions={[]}
						onZoomAdded={() => undefined}
						onZoomSpanChange={() => undefined}
						onZoomDelete={() => undefined}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						annotationRegions={[]}
						onAnnotationAdded={onAnnotationAdded}
						onRectangleAdded={onRectangleAdded}
						onArrowAdded={onArrowAdded}
						onImageAddRequested={onImageAddRequested}
						aspectRatio="16:9"
						onAspectRatioChange={() => undefined}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.keyDown(window, { key: "a" });
		fireEvent.keyDown(window, { key: "r" });
		fireEvent.keyDown(window, { key: "A", shiftKey: true });
		fireEvent.keyDown(window, { key: "i" });

		expect(onAnnotationAdded).toHaveBeenCalledOnce();
		expect(onRectangleAdded).toHaveBeenCalledOnce();
		expect(onArrowAdded).toHaveBeenCalledOnce();
		expect(onImageAddRequested).toHaveBeenCalledOnce();
		expect(onRectangleAdded).toHaveBeenCalledWith({ start: 2000, end: 3000 });
	});
});
