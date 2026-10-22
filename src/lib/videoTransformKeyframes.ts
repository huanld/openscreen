import {
	DEFAULT_VIDEO_SCALE,
	MAX_VIDEO_SCALE,
	MIN_VIDEO_SCALE,
	type VideoPosition,
	type VideoTransformKeyframe,
} from "@/components/video-editor/types";

export interface ResolvedVideoTransform {
	position: VideoPosition | null;
	scale: number;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizedPosition(position: VideoPosition | null | undefined): VideoPosition {
	return position
		? { cx: clamp(position.cx, 0, 1), cy: clamp(position.cy, 0, 1) }
		: { cx: 0.5, cy: 0.5 };
}

function samePosition(left: VideoPosition, right: VideoPosition) {
	return Math.abs(left.cx - right.cx) < 0.000001 && Math.abs(left.cy - right.cy) < 0.000001;
}

function sanitizeTransform(
	position: VideoPosition | null | undefined,
	scale: number | null | undefined,
): ResolvedVideoTransform {
	return {
		position: position
			? {
					cx: clamp(position.cx, 0, 1),
					cy: clamp(position.cy, 0, 1),
				}
			: null,
		scale: clamp(
			Number.isFinite(scale) ? (scale ?? DEFAULT_VIDEO_SCALE) : DEFAULT_VIDEO_SCALE,
			MIN_VIDEO_SCALE,
			MAX_VIDEO_SCALE,
		),
	};
}

/**
 * Resolve the main-video transform at a timeline time. The saved static layout
 * remains active before the first keyframe. Between keyframes, smoothstep
 * interpolation gives a Canva/PowerPoint-style resize and move animation.
 */
export function resolveVideoTransformAtTime(
	keyframes: readonly VideoTransformKeyframe[] | undefined,
	timeMs: number,
	fallbackPosition: VideoPosition | null | undefined,
	fallbackScale: number | null | undefined,
): ResolvedVideoTransform {
	const fallback = sanitizeTransform(fallbackPosition, fallbackScale);
	if (!keyframes?.length) return fallback;

	const sorted = [...keyframes].sort((left, right) => left.timeMs - right.timeMs);
	const nextIndex = sorted.findIndex((keyframe) => timeMs < keyframe.timeMs);
	if (nextIndex === 0) return fallback;
	if (nextIndex < 0) {
		const last = sorted[sorted.length - 1];
		return sanitizeTransform(last.position, last.scale);
	}

	const previous = sorted[nextIndex - 1];
	const next = sorted[nextIndex];
	const duration = Math.max(1, next.timeMs - previous.timeMs);
	const rawProgress = clamp((timeMs - previous.timeMs) / duration, 0, 1);
	const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
	const previousPosition = normalizedPosition(previous.position);
	const nextPosition = normalizedPosition(next.position);
	const position = {
		cx: previousPosition.cx + (nextPosition.cx - previousPosition.cx) * progress,
		cy: previousPosition.cy + (nextPosition.cy - previousPosition.cy) * progress,
	};

	return {
		position:
			previous.position === null &&
			next.position === null &&
			samePosition(position, { cx: 0.5, cy: 0.5 })
				? null
				: position,
		scale: clamp(
			previous.scale + (next.scale - previous.scale) * progress,
			MIN_VIDEO_SCALE,
			MAX_VIDEO_SCALE,
		),
	};
}
