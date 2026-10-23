import type { BlankSlideRegion, SlideTransitionType } from "@/components/video-editor/types";

export const DEFAULT_SLIDE_TRANSITION_DURATION_MS = 450;
export const MAX_SLIDE_TRANSITION_DURATION_MS = 2_000;
export const SLIDE_TRANSITION_TYPES = [
	"none",
	"fade",
	"slide-left",
	"slide-right",
	"slide-up",
	"slide-down",
	"zoom",
] as const satisfies readonly SlideTransitionType[];

export interface BlankSlidePresentation {
	region: BlankSlideRegion;
	phase: "enter" | "hold" | "exit";
	progress: number;
	opacity: number;
	offsetX: number;
	offsetY: number;
	scale: number;
}

export function isSlideTransitionType(value: unknown): value is SlideTransitionType {
	return SLIDE_TRANSITION_TYPES.some((type) => type === value);
}

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number) {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}

function transitionPresentation(
	region: BlankSlideRegion,
	type: SlideTransitionType,
	phase: BlankSlidePresentation["phase"],
	progress: number,
): BlankSlidePresentation {
	const eased = smoothstep(progress);
	const hiddenAmount = 1 - eased;
	const presentation: BlankSlidePresentation = {
		region,
		phase,
		progress: eased,
		opacity: 1,
		offsetX: 0,
		offsetY: 0,
		scale: 1,
	};

	switch (type) {
		case "fade":
			presentation.opacity = eased;
			break;
		case "slide-left":
			presentation.offsetX = -hiddenAmount;
			break;
		case "slide-right":
			presentation.offsetX = hiddenAmount;
			break;
		case "slide-up":
			presentation.offsetY = -hiddenAmount;
			break;
		case "slide-down":
			presentation.offsetY = hiddenAmount;
			break;
		case "zoom":
			presentation.opacity = eased;
			presentation.scale = 0.92 + eased * 0.08;
			break;
	}

	return presentation;
}

export function resolveBlankSlidePresentation(
	regions: readonly BlankSlideRegion[] | undefined,
	timeMs: number,
): BlankSlidePresentation | null {
	const region = regions?.find(
		(candidate) => timeMs >= candidate.startMs && timeMs < candidate.endMs,
	);
	if (!region) return null;

	const spanMs = Math.max(1, region.endMs - region.startMs);
	const durationMs = Math.min(
		Math.max(0, region.transitionDurationMs ?? DEFAULT_SLIDE_TRANSITION_DURATION_MS),
		MAX_SLIDE_TRANSITION_DURATION_MS,
		spanMs / 2,
	);
	const transitionIn = region.transitionIn ?? "none";
	const transitionOut = region.transitionOut ?? "none";
	const enterProgress =
		transitionIn === "none" || durationMs === 0
			? 1
			: clamp01((timeMs - region.startMs) / durationMs);
	const exitProgress =
		transitionOut === "none" || durationMs === 0
			? 1
			: clamp01((region.endMs - timeMs) / durationMs);

	if (enterProgress < 1 && enterProgress <= exitProgress) {
		return transitionPresentation(region, transitionIn, "enter", enterProgress);
	}
	if (exitProgress < 1) {
		return transitionPresentation(region, transitionOut, "exit", exitProgress);
	}

	return transitionPresentation(region, "none", "hold", 1);
}

export function isBlankSlideActive(
	regions: readonly BlankSlideRegion[] | undefined,
	timeMs: number,
) {
	return resolveBlankSlidePresentation(regions, timeMs) !== null;
}
