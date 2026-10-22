import { cleanup, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSnapGuides } from "@/components/editor/CanvasSnapGuides";
import { type CanvasDragSnap, type CanvasSnapGuide, snapCanvasRect } from "@/lib/canvasSnapping";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "./types";
import { type PreviewVideoRegion, VideoComponentOverlay } from "./VideoComponentOverlay";

afterEach(cleanup);
const annotation: AnnotationRegion = {
	id: "moving",
	type: "text",
	content: "Drag me",
	startMs: 0,
	endMs: 2_000,
	position: { x: 10, y: 10 },
	size: { width: 20, height: 20 },
	style: DEFAULT_ANNOTATION_STYLE,
	zIndex: 1,
};
const video: PreviewVideoRegion = {
	id: "moving",
	name: "Video",
	sourcePath: "video.mp4",
	previewUrl: "",
	startMs: 0,
	endMs: 2_000,
	sourceDurationMs: 2_000,
	position: { x: 10, y: 10 },
	size: { width: 20, height: 20 },
	frameAspectRatio: "free",
	zIndex: 1,
};

function SnapSurface({
	kind,
	scale = 1,
	onCommit,
}: {
	kind: "annotation" | "video";
	scale?: number;
	onCommit: (position: { x: number; y: number }) => void;
}) {
	const [position, setPosition] = useState({ x: 10, y: 10 });
	const [guides, setGuides] = useState<CanvasSnapGuide[]>([]);
	const clear = useCallback(() => setGuides([]), []);
	const snap: CanvasDragSnap = (rect, bypass, bounds) => {
		const result = snapCanvasRect({
			rect,
			frame: { x: 0, y: 0, width: 800, height: 450 },
			targets: [{ id: "other", x: 123, y: 83, width: 80, height: 70 }],
			threshold: 6 / scale,
			disabled: bypass,
			bounds,
		});
		setGuides(result.guides);
		return result;
	};
	const commit = (next: { x: number; y: number }) => {
		setPosition(next);
		onCommit(next);
	};
	return (
		<div
			data-testid="snap-surface"
			style={{
				width: 800,
				height: 450,
				position: "relative",
				transform: `scale(${scale})`,
				transformOrigin: "top left",
			}}
		>
			{kind === "annotation" ? (
				<AnnotationOverlay
					annotation={{ ...annotation, position }}
					isSelected
					containerWidth={800}
					containerHeight={450}
					currentTimeMs={1_000}
					onPositionChange={(_id, next) => commit(next)}
					onSizeChange={() => undefined}
					onClick={() => undefined}
					zIndex={1}
					isSelectedBoost
					onSnapDrag={snap}
					onSnapEnd={clear}
				/>
			) : (
				<VideoComponentOverlay
					region={{ ...video, position }}
					containerWidth={800}
					containerHeight={450}
					currentTime={1}
					isPlaying={false}
					isSelected
					onSelect={() => undefined}
					onGeometryChange={(_id, patch) => {
						if (patch.position) commit(patch.position);
					}}
					onDelete={() => undefined}
					onSnapDrag={snap}
					onSnapEnd={clear}
				/>
			)}
			<CanvasSnapGuides guides={guides} width={800} height={450} />
		</div>
	);
}

async function dragPoint(
	surface: HTMLElement,
	phase: "down" | "move" | "up",
	x: number,
	y: number,
	altKey = false,
) {
	const rect = surface.getBoundingClientRect();
	const clientX = rect.left + (x * rect.width) / 800;
	const clientY = rect.top + (y * rect.height) / 450;
	const target = phase === "down" ? document.elementFromPoint(clientX, clientY) : document;
	if (!target) throw new Error("Drag target unavailable");
	target.dispatchEvent(
		new MouseEvent(`mouse${phase}`, {
			clientX,
			clientY,
			altKey,
			bubbles: true,
			cancelable: true,
			button: 0,
			buttons: phase === "up" ? 0 : 1,
		}),
	);
	await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe("canvas snapping in video overlays", () => {
	it.each([
		"annotation",
		"video",
	] as const)("snaps a %s live, releases the guide without sticking, and commits its final position", async (kind) => {
		const onCommit = vi.fn();
		render(<SnapSurface kind={kind} onCommit={onCommit} />);
		const surface = screen.getByTestId("snap-surface");
		const overlay = screen.getByTestId(
			kind === "annotation" ? "annotation-overlay-moving" : "video-component-moving",
		);
		await dragPoint(surface, "down", 145, 95);
		await dragPoint(surface, "move", 388, 226);
		await vi.waitFor(() => {
			const bounds = overlay.getBoundingClientRect();
			const canvas = surface.getBoundingClientRect();
			expect(bounds.left - canvas.left).toBeCloseTo(320);
			expect(bounds.top - canvas.top).toBeCloseTo(180);
		});
		expect(screen.getByTestId("canvas-snap-guides").querySelectorAll("line")).toHaveLength(2);
		for (const x of [389, 390, 391, 392, 394, 398]) {
			await dragPoint(surface, "move", x, 226);
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		await vi.waitFor(() =>
			expect(
				overlay.getBoundingClientRect().left - surface.getBoundingClientRect().left,
			).toBeCloseTo(333),
		);
		await dragPoint(surface, "up", 398, 226);
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
		expect(onCommit).toHaveBeenCalledWith({ x: (333 / 800) * 100, y: 40 });
		expect(screen.queryByTestId("canvas-snap-guides")).toBeNull();
	});
	it("aligns to another element's edge and saves that exact position", async () => {
		const onCommit = vi.fn();
		render(<SnapSurface kind="annotation" onCommit={onCommit} />);
		const surface = screen.getByTestId("snap-surface");
		await dragPoint(surface, "down", 145, 95);
		await dragPoint(surface, "move", 270, 240);
		await dragPoint(surface, "up", 270, 240);
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
		expect(onCommit.mock.calls[0][0].x).toBe((203 / 800) * 100);
	});
	it("bypasses guides with Alt, including in a scaled preview", async () => {
		const onCommit = vi.fn();
		render(<SnapSurface kind="annotation" scale={0.5} onCommit={onCommit} />);
		const surface = screen.getByTestId("snap-surface");
		await dragPoint(surface, "down", 146, 96);
		await dragPoint(surface, "move", 388, 226, true);
		await dragPoint(surface, "up", 388, 226, true);
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
		expect(onCommit).toHaveBeenCalledWith({ x: (322 / 800) * 100, y: (175 / 450) * 100 });
		expect(screen.queryByTestId("canvas-snap-guides")).toBeNull();
	});
});
