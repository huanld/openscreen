export type AnnotationAnimationType = "none" | "fade-in" | "typewriter" | "pop-in" | "slide-up";

export interface ComputeAnimationInput {
	animation?: AnnotationAnimationType | string;
	type?: string;
	content?: string;
	timeMs: number;
	startMs: number;
	endMs: number;
	durationMs?: number;
}

export interface AnimationResult {
	opacity: number;
	scale: number;
	translateY: number;
	displayedText?: string;
}

export function computeAnnotationAnimation(input: ComputeAnimationInput): AnimationResult {
	const { animation = "none", type = "text", content = "", timeMs, startMs } = input;

	if (animation === "none" || !animation) {
		return {
			opacity: 1,
			scale: 1,
			translateY: 0,
			displayedText: content,
		};
	}

	const elapsed = Math.max(0, timeMs - startMs);

	if (animation === "fade-in") {
		const duration = input.durationMs ?? 500;
		const progress = Math.min(1, Math.max(0, elapsed / duration));
		return {
			opacity: progress,
			scale: 1,
			translateY: 0,
			displayedText: content,
		};
	}

	if (animation === "pop-in") {
		const duration = input.durationMs ?? 500;
		const progress = Math.min(1, Math.max(0, elapsed / duration));
		return {
			opacity: progress,
			scale: 0.6 + 0.4 * progress,
			translateY: 0,
			displayedText: content,
		};
	}

	if (animation === "slide-up") {
		const duration = input.durationMs ?? 500;
		const progress = Math.min(1, Math.max(0, elapsed / duration));
		return {
			opacity: progress,
			scale: 1,
			translateY: 20 * (1 - progress),
			displayedText: content,
		};
	}

	if (animation === "typewriter" && type === "text") {
		const duration = input.durationMs ?? 1500;
		const progress = Math.min(1, Math.max(0, elapsed / duration));
		const charCount = Math.floor(progress * content.length);
		return {
			opacity: 1,
			scale: 1,
			translateY: 0,
			displayedText: content.slice(0, charCount),
		};
	}

	return {
		opacity: 1,
		scale: 1,
		translateY: 0,
		displayedText: content,
	};
}
