import { Trash2 } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { useSnappedCanvasDrag } from "@/hooks/useSnappedCanvasDrag";
import type { CanvasDragSnap } from "@/lib/canvasSnapping";
import { isSourcePausedAt } from "@/lib/insertedSlideTiming";
import { getMediaClipGain } from "@/lib/mediaClipTiming";
import { clipContentTimeMs, clipEndWithSlides } from "@/lib/slideAwareMediaClip";
import { calculateVideoRegionMediaLayout } from "@/lib/videoRegionLayout";
import type { BlankSlideRegion, VideoRegion } from "./types";

export type PreviewVideoRegion = VideoRegion & { previewUrl: string };

interface VideoComponentOverlayProps {
	region: PreviewVideoRegion;
	containerWidth: number;
	containerHeight: number;
	currentTime: number;
	isPlaying: boolean;
	blankSlideRegions?: BlankSlideRegion[];
	playbackRate?: number;
	isSelected: boolean;
	onSelect: (id: string) => void;
	onGeometryChange: (id: string, patch: Partial<Pick<VideoRegion, "position" | "size">>) => void;
	onDelete: (id: string) => void;
	onSnapDrag?: CanvasDragSnap;
	onSnapEnd?: () => void;
}

export function VideoComponentOverlay({
	region,
	containerWidth,
	containerHeight,
	currentTime,
	isPlaying,
	blankSlideRegions = [],
	playbackRate = 1,
	isSelected,
	onSelect,
	onGeometryChange,
	onDelete,
	onSnapDrag,
	onSnapEnd,
}: VideoComponentOverlayProps) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const committedX = (region.position.x / 100) * containerWidth;
	const committedY = (region.position.y / 100) * containerHeight;
	const committedWidth = (region.size.width / 100) * containerWidth;
	const committedHeight = (region.size.height / 100) * containerHeight;
	const [liveRect, setLiveRect] = useState({
		x: committedX,
		y: committedY,
		width: committedWidth,
		height: committedHeight,
	});
	const drag = useSnappedCanvasDrag({
		rect: { ...liveRect, id: `video:${region.id}` },
		width: containerWidth,
		height: containerHeight,
		onPreview: (position) => setLiveRect((previous) => ({ ...previous, ...position })),
		onCommit: (position) =>
			onGeometryChange(region.id, {
				position: {
					x: (position.x / containerWidth) * 100,
					y: (position.y / containerHeight) * 100,
				},
			}),
		onSnap: onSnapDrag,
		onSnapEnd,
	});
	const [sourceDimensions, setSourceDimensions] = useState({
		width: region.sourceWidth ?? 0,
		height: region.sourceHeight ?? 0,
	});
	const timelineTimeMs = currentTime * 1000;
	const isActive =
		timelineTimeMs >= region.startMs &&
		timelineTimeMs < clipEndWithSlides(region, blankSlideRegions);
	const mediaLayout = calculateVideoRegionMediaLayout({
		sourceWidth: sourceDimensions.width,
		sourceHeight: sourceDimensions.height,
		target: { x: 0, y: 0, width: liveRect.width, height: liveRect.height },
		fitMode: region.fitMode,
		cropPosition: region.cropPosition,
		cropZoom: region.cropZoom,
	});

	useEffect(() => {
		setLiveRect({
			x: committedX,
			y: committedY,
			width: committedWidth,
			height: committedHeight,
		});
	}, [committedX, committedY, committedWidth, committedHeight]);

	useEffect(() => {
		setSourceDimensions({
			width: region.sourceWidth ?? 0,
			height: region.sourceHeight ?? 0,
		});
	}, [region.sourceHeight, region.sourceWidth]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		const contentMs = clipContentTimeMs(region, timelineTimeMs, blankSlideRegions);
		const localTime = Math.max(0, contentMs - region.startMs + (region.sourceStartMs ?? 0)) / 1000;
		video.playbackRate = playbackRate;
		video.volume = Math.min(
			1,
			getMediaClipGain({ ...region, volume: region.volume ?? 0 }, contentMs),
		);
		video.muted = (region.volume ?? 0) === 0;
		const sourceDuration = Number.isFinite(video.duration)
			? video.duration
			: region.sourceDurationMs / 1000;
		const desiredTime = Math.min(localTime, Math.max(0, sourceDuration - 0.04));
		if (Math.abs(video.currentTime - desiredTime) > (isPlaying ? 0.12 : 0.02)) {
			video.currentTime = desiredTime;
		}

		if (
			isPlaying &&
			isActive &&
			!isSourcePausedAt(timelineTimeMs, blankSlideRegions) &&
			desiredTime < sourceDuration - 0.04
		) {
			void video.play().catch(() => undefined);
		} else {
			video.pause();
		}
	}, [isActive, isPlaying, playbackRate, region, timelineTimeMs, blankSlideRegions]);

	if (!isActive && !isSelected) return null;

	return (
		<Rnd
			ref={drag.rndRef}
			position={{ x: liveRect.x, y: liveRect.y }}
			size={{ width: liveRect.width, height: liveRect.height }}
			bounds="parent"
			lockAspectRatio={
				region.frameAspectRatio === "free"
					? false
					: Math.max(
							0.01,
							(region.size.width * containerWidth) / (region.size.height * containerHeight),
						)
			}
			disableDragging={false}
			enableResizing={isSelected}
			onPointerDown={(event: ReactPointerEvent) => {
				event.stopPropagation();
				onSelect(region.id);
			}}
			onDragStart={(event, data) => {
				drag.start(event, data);
				onSelect(region.id);
			}}
			onDrag={drag.move}
			onDragStop={drag.stop}
			onResize={(_event, _direction, element, _delta, position) => {
				setLiveRect({
					x: position.x,
					y: position.y,
					width: element.offsetWidth,
					height: element.offsetHeight,
				});
			}}
			onResizeStop={(_event, _direction, element, _delta, position) => {
				const nextRect = {
					x: position.x,
					y: position.y,
					width: element.offsetWidth,
					height: element.offsetHeight,
				};
				setLiveRect(nextRect);
				onGeometryChange(region.id, {
					position: {
						x: (nextRect.x / containerWidth) * 100,
						y: (nextRect.y / containerHeight) * 100,
					},
					size: {
						width: (nextRect.width / containerWidth) * 100,
						height: (nextRect.height / containerHeight) * 100,
					},
				});
			}}
			data-testid={`video-component-${region.id}`}
			className={isSelected ? "ring-2 ring-[#34B27B] ring-offset-2 ring-offset-black/30" : ""}
			style={{
				zIndex: isSelected ? 60_000 : 40_000 + region.zIndex,
				cursor: isSelected ? "move" : "pointer",
				pointerEvents: "auto",
			}}
			resizeHandleStyles={{
				topLeft: handleStyle("nwse-resize", isSelected),
				topRight: handleStyle("nesw-resize", isSelected),
				bottomLeft: handleStyle("nesw-resize", isSelected),
				bottomRight: handleStyle("nwse-resize", isSelected),
			}}
		>
			<div className="relative h-full w-full overflow-hidden rounded-lg bg-black shadow-xl">
				<video
					ref={videoRef}
					src={region.previewUrl}
					className="pointer-events-none absolute max-w-none"
					style={
						mediaLayout
							? {
									left: mediaLayout.media.x,
									top: mediaLayout.media.y,
									width: mediaLayout.media.width,
									height: mediaLayout.media.height,
								}
							: { inset: 0, width: "100%", height: "100%", objectFit: "cover" }
					}
					onLoadedMetadata={(event) => {
						const video = event.currentTarget;
						if (video.videoWidth > 0 && video.videoHeight > 0) {
							setSourceDimensions({ width: video.videoWidth, height: video.videoHeight });
						}
					}}
					muted={(region.volume ?? 0) === 0}
					playsInline
					preload="auto"
				/>
				{isSelected && (
					<>
						<div className="pointer-events-none absolute left-2 top-2 max-w-[70%] truncate rounded bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">
							{region.name}
						</div>
						<button
							type="button"
							aria-label="Delete video component"
							title="Delete video"
							className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-red-500/85 text-white shadow hover:bg-red-500"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onDelete(region.id);
							}}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					</>
				)}
			</div>
		</Rnd>
	);
}

function handleStyle(cursor: string, visible: boolean) {
	return {
		width: "14px",
		height: "14px",
		backgroundColor: visible ? "#34B27B" : "transparent",
		border: visible ? "2px solid white" : "none",
		borderRadius: "4px",
		cursor,
	};
}
