import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { resizeMediaClipSpan } from "@/lib/mediaClipTiming";
import AudioTrackPreview from "./AudioTrackPreview";
import { MediaClipSettingsPanel } from "./MediaClipSettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import { VideoComponentOverlay } from "./VideoComponentOverlay";
import { VideoComponentSettingsPanel } from "./VideoComponentSettingsPanel";

const video = {
	id: "video-component-1",
	name: "Demo",
	startMs: 1000,
	endMs: 4000,
	sourcePath: "/demo.webm",
	sourceDurationMs: 8000,
	sourceStartMs: 2000,
	position: { x: 0, y: 0 },
	size: { width: 50, height: 50 },
	zIndex: 1,
	volume: 0.4,
	fadeInMs: 1000,
	fadeOutMs: 1000,
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("media clip editor controls", () => {
	it("routes a real left-edge resize to the video clip and advances source in", async () => {
		const changed = vi.fn();
		function EditableVideoTimeline() {
			const [clip, setClip] = useState(video);
			return (
				<div style={{ width: 1200, height: 900, display: "flex" }}>
					<I18nProvider>
						<ShortcutsProvider>
							<TimelineEditor
								videoDuration={10}
								currentTime={0}
								zoomRegions={[]}
								selectedZoomId={null}
								onZoomAdded={vi.fn()}
								onZoomSpanChange={vi.fn()}
								onZoomDelete={vi.fn()}
								onSelectZoom={vi.fn()}
								videoRegions={[clip]}
								selectedVideoRegionId={clip.id}
								onSelectVideoRegion={vi.fn()}
								onVideoClipSpanChange={(_id, span) => {
									const next = resizeMediaClipSpan(clip, span);
									changed(next);
									setClip(next);
								}}
								aspectRatio="16:9"
								onAspectRatioChange={vi.fn()}
							/>
						</ShortcutsProvider>
					</I18nProvider>
				</div>
			);
		}
		const view = render(<EditableVideoTimeline />);
		const item = view.container.querySelector<HTMLElement>("[data-timeline-item-id]")!;
		await vi.waitFor(() => expect(item.getBoundingClientRect().width).toBeGreaterThan(80));
		const rect = item.getBoundingClientRect();
		const x = rect.left + 3;
		const y = rect.top + rect.height / 2;
		const point = (clientX: number, buttons: number) => ({
			bubbles: true,
			cancelable: true,
			pointerId: 1,
			isPrimary: true,
			pointerType: "mouse",
			button: 0,
			buttons,
			clientX,
			clientY: y,
		});
		const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
		item.dispatchEvent(new PointerEvent("pointerdown", point(x, 1)));
		await frame();
		document.dispatchEvent(new PointerEvent("pointermove", point(x + 12, 1)));
		await frame();
		document.dispatchEvent(new PointerEvent("pointermove", point(x + rect.width / 3, 1)));
		await frame();
		document.dispatchEvent(new PointerEvent("pointerup", point(x + rect.width / 3, 0)));
		await frame();
		expect(changed).toHaveBeenCalledOnce();
		const edited = changed.mock.calls[0][0];
		expect(edited.startMs).toBeGreaterThan(video.startMs);
		expect(edited.endMs).toBe(video.endMs);
		expect(edited.sourceStartMs).toBe(video.sourceStartMs + edited.startMs - video.startMs);
	});

	it("offers a full canvas placement for an imported video", () => {
		const fill = vi.fn();
		const view = render(
			<I18nProvider>
				<VideoComponentSettingsPanel
					region={video}
					onFillCanvas={fill}
					onAppearanceChange={vi.fn()}
					onAppearancePreview={vi.fn()}
					onAppearanceCommit={vi.fn()}
					onAspectRatioChange={vi.fn()}
					onDelete={vi.fn()}
				/>
			</I18nProvider>,
		);
		fireEvent.click(view.getByRole("button", { name: "Fill canvas with video" }));
		expect(fill).toHaveBeenCalledOnce();
	});
	it("commits source trim, duration, volume and fade once; Escape cancels", () => {
		const onChange = vi.fn();
		const onSplit = vi.fn();
		const view = render(
			<I18nProvider>
				<MediaClipSettingsPanel
					clip={video}
					currentTime={2}
					timelineDuration={10}
					onChange={onChange}
					onSplit={onSplit}
				/>
			</I18nProvider>,
		);
		for (const [label, value, patch] of [
			["Start in source (s)", "3.2", { sourceStartMs: 3200 }],
			["Duration (s)", "2", { endMs: 3000 }],
			["Volume (%)", "25", { volume: 0.25 }],
			["Audio fade out (s)", "0.5", { fadeOutMs: 500 }],
		] as const) {
			const field = view.getByLabelText(label);
			fireEvent.change(field, { target: { value } });
			fireEvent.blur(field);
			expect(onChange).toHaveBeenLastCalledWith(patch);
		}
		expect(onChange).toHaveBeenCalledTimes(4);
		const field = view.getByLabelText("Start in source (s)");
		field.focus();
		fireEvent.change(field, { target: { value: "4" } });
		fireEvent.keyDown(field, { key: "Escape" });
		expect(onChange).toHaveBeenCalledTimes(4);
		fireEvent.click(view.getByRole("button", { name: "Split at playhead" }));
		expect(onSplit).toHaveBeenCalledOnce();
		fireEvent.click(view.getByRole("button", { name: "Mute clip" }));
		expect(onChange).toHaveBeenLastCalledWith({ volume: 0 });
	});

	it("shows overlapping media on separate rows and selects video clips", () => {
		const select = vi.fn();
		const view = render(
			<I18nProvider>
				<ShortcutsProvider>
					<TimelineEditor
						videoDuration={10}
						currentTime={2}
						zoomRegions={[]}
						selectedZoomId={null}
						onZoomAdded={vi.fn()}
						onZoomSpanChange={vi.fn()}
						onZoomDelete={vi.fn()}
						onSelectZoom={vi.fn()}
						videoRegions={[video, { ...video, id: "video-component-2", name: "Second" }]}
						onSelectVideoRegion={select}
						audioRegions={[
							{ ...video, id: "audio-1" },
							{ ...video, id: "audio-2" },
						]}
						aspectRatio="16:9"
						onAspectRatioChange={vi.fn()}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);
		const items = [...view.container.querySelectorAll("[data-timeline-item-id]")];
		expect(items).toHaveLength(4);
		expect(new Set(items.map((item) => item.parentElement?.parentElement)).size).toBe(4);
		fireEvent.click(view.getByText("Second"));
		expect(select).toHaveBeenLastCalledWith("video-component-2");
	});

	it("previews trimmed audio and video with the same fade and timeline speed", () => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
		const view = render(
			<div style={{ width: 640, height: 360 }}>
				<AudioTrackPreview
					region={video}
					sourceUrl=""
					currentTime={1.5}
					isPlaying={false}
					speedRegions={[]}
				/>
				<VideoComponentOverlay
					region={{ ...video, previewUrl: "" }}
					containerWidth={640}
					containerHeight={360}
					currentTime={1.5}
					isPlaying={false}
					playbackRate={2}
					isSelected={true}
					onSelect={vi.fn()}
					onGeometryChange={vi.fn()}
					onDelete={vi.fn()}
				/>
			</div>,
		);
		const audio = view.container.querySelector("audio")!;
		const media = view.container.querySelector("video")!;
		expect(audio.currentTime).toBeCloseTo(2.5);
		expect(media.currentTime).toBeCloseTo(2.5);
		expect(audio.volume).toBeCloseTo(0.2);
		expect(media.volume).toBeCloseTo(0.2);
		expect(media.muted).toBe(false);
		expect(media.playbackRate).toBe(2);
	});
});
