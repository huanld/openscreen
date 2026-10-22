import type { AnnotationRegion, VideoRegion } from "@/components/video-editor/types";
import { isCanvasAnchoredAnnotation } from "./annotationViewport";
import { type CanvasRect, getRotatedCanvasRect } from "./canvasSnapping";

/** Match the preview's visibility and map recording-local elements into the full canvas. */
export function getVideoCanvasSnapTargets({
	width,
	height,
	timeMs,
	isBlankSlide,
	mainVideo,
	webcam,
	annotations = [],
	blurs = [],
	videos = [],
	selectedAnnotationId,
	selectedBlurId,
	selectedVideoId,
}: {
	width: number;
	height: number;
	timeMs: number;
	isBlankSlide: boolean;
	mainVideo: CanvasRect | null;
	webcam: CanvasRect | null;
	annotations?: readonly AnnotationRegion[];
	blurs?: readonly AnnotationRegion[];
	videos?: readonly VideoRegion[];
	selectedAnnotationId?: string | null;
	selectedBlurId?: string | null;
	selectedVideoId?: string | null;
}): CanvasRect[] {
	const canvas = { x: 0, y: 0, width, height };
	const viewport = isBlankSlide ? canvas : (mainVideo ?? canvas);
	const targets: CanvasRect[] = [];
	for (const [regions, selectedId, prefix] of [
		[annotations, selectedAnnotationId, "annotation"],
		[blurs, selectedBlurId, "blur"],
	] as const) {
		for (const annotation of regions) {
			if (!Number.isFinite(annotation.startMs) || !Number.isFinite(annotation.endMs)) continue;
			if (
				annotation.id !== selectedId &&
				(timeMs < annotation.startMs || timeMs >= annotation.endMs)
			)
				continue;
			const isCanvas = isBlankSlide || isCanvasAnchoredAnnotation(annotation);
			const space = isCanvas ? canvas : viewport;
			targets.push(
				getRotatedCanvasRect(
					{
						id: `${prefix}:${annotation.id}`,
						ownerId: isCanvas ? undefined : "main-video",
						x: space.x + (annotation.position.x / 100) * space.width,
						y: space.y + (annotation.position.y / 100) * space.height,
						width: (annotation.size.width / 100) * space.width,
						height: (annotation.size.height / 100) * space.height,
					},
					annotation.type === "blur" || annotation.type === "pen" ? 0 : annotation.rotation,
				),
			);
		}
	}
	if (!isBlankSlide) {
		if (mainVideo) targets.push({ ...mainVideo, id: "main-video" });
		if (webcam) targets.push({ ...webcam, id: "webcam" });
		for (const video of videos) {
			if (video.id !== selectedVideoId && (timeMs < video.startMs || timeMs >= video.endMs))
				continue;
			targets.push({
				id: `video:${video.id}`,
				x: (video.position.x / 100) * width,
				y: (video.position.y / 100) * height,
				width: (video.size.width / 100) * width,
				height: (video.size.height / 100) * height,
			});
		}
	}
	return targets;
}
