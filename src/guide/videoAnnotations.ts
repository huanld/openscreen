import {
	type AnnotationRegion,
	type ArrowDirection,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_MAGNIFIER_DATA,
	type SpeedRegion,
} from "@/components/video-editor/types";
import type { GeneratedGuideStep, GuideSession, GuideStepCandidate } from "./contracts";

export interface BuildGuideVideoAnnotationsOptions {
	nextId: () => string;
	nextZIndex: () => number;
	defaultDurationMs?: number;
}

const DEFAULT_STEP_DURATION_MS = 2000;
const DEFAULT_STEP_SLOW_MOTION_DURATION_MS = 2000;
const DEFAULT_STEP_SLOW_MOTION_SPEED = 0.3;
const CAPTION_WIDTH = 34;
const CAPTION_HEIGHT = 13;
const MAGNIFIER_SIZE = 18;
const ARROW_SIZE = 10;
const ANNOTATION_GAP = 2;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function findCandidate(
	step: GeneratedGuideStep,
	stepIndex: number,
	candidates: GuideStepCandidate[],
): GuideStepCandidate | undefined {
	if (step.sourceCandidateId) {
		const matched = candidates.find((candidate) => candidate.id === step.sourceCandidateId);
		if (matched) return matched;
	}
	const sorted = [...candidates].sort((left, right) => left.timeMs - right.timeMs);
	return sorted[stepIndex];
}

function getCaptionPosition(candidate: GuideStepCandidate | undefined) {
	const target = candidate?.position;
	if (!target) {
		return { x: 8, y: 8 };
	}

	const targetX = target.normalizedX * 100;
	const targetY = target.normalizedY * 100;
	const x = target.normalizedX < 0.5 ? targetX + 8 : targetX - CAPTION_WIDTH - 8;
	const y = target.normalizedY < 0.5 ? targetY + 8 : targetY - CAPTION_HEIGHT - 8;

	return {
		x: clamp(x, 2, 100 - CAPTION_WIDTH - 2),
		y: clamp(y, 2, 100 - CAPTION_HEIGHT - 2),
	};
}

function getArrowDirection(
	candidate: GuideStepCandidate | undefined,
	originPosition: { x: number; y: number },
	originSize: { width: number; height: number } = {
		width: CAPTION_WIDTH,
		height: CAPTION_HEIGHT,
	},
): ArrowDirection {
	const target = candidate?.position;
	if (!target) return "right";

	const originCenterX = originPosition.x + originSize.width / 2;
	const originCenterY = originPosition.y + originSize.height / 2;
	const dx = target.normalizedX * 100 - originCenterX;
	const dy = target.normalizedY * 100 - originCenterY;
	const horizontal = dx > 8 ? "right" : dx < -8 ? "left" : "";
	const vertical = dy > 8 ? "down" : dy < -8 ? "up" : "";

	if (vertical && horizontal) return `${vertical}-${horizontal}` as ArrowDirection;
	return (horizontal || vertical || "right") as ArrowDirection;
}

function getMagnifierPosition(captionPosition: { x: number; y: number }) {
	const canPlaceRight = captionPosition.x + CAPTION_WIDTH + ANNOTATION_GAP + MAGNIFIER_SIZE <= 98;
	const x = canPlaceRight
		? captionPosition.x + CAPTION_WIDTH + ANNOTATION_GAP
		: captionPosition.x - MAGNIFIER_SIZE - ANNOTATION_GAP;
	const y = captionPosition.y + (CAPTION_HEIGHT - MAGNIFIER_SIZE) / 2;

	return {
		x: clamp(x, 2, 100 - MAGNIFIER_SIZE - 2),
		y: clamp(y, 2, 100 - MAGNIFIER_SIZE - 2),
	};
}

function getArrowPosition(
	position: NonNullable<GuideStepCandidate["position"]>,
	originPosition: { x: number; y: number },
	originSize: { width: number; height: number },
) {
	const targetX = position.normalizedX * 100;
	const targetY = position.normalizedY * 100;
	const originCenterX = originPosition.x + originSize.width / 2;
	const originCenterY = originPosition.y + originSize.height / 2;
	const distance = Math.hypot(targetX - originCenterX, targetY - originCenterY);
	const targetOffset = Math.min(18, Math.max(10, distance * 0.35));
	const ratio = distance > 0 ? Math.max(0, (distance - targetOffset) / distance) : 0;
	const arrowCenterX = originCenterX + (targetX - originCenterX) * ratio;
	const arrowCenterY = originCenterY + (targetY - originCenterY) * ratio;

	return {
		x: clamp(arrowCenterX - ARROW_SIZE / 2, 0, 100 - ARROW_SIZE),
		y: clamp(arrowCenterY - ARROW_SIZE / 2, 0, 100 - ARROW_SIZE),
	};
}

function buildCaption(step: GeneratedGuideStep) {
	const instruction = step.instruction.trim();
	const title = step.title.trim();
	if (instruction) {
		return `${step.order}. ${instruction}`;
	}
	return title ? `${step.order}. ${title}` : `Step ${step.order}`;
}

export function buildGuideVideoAnnotations(
	session: GuideSession,
	options: BuildGuideVideoAnnotationsOptions,
): AnnotationRegion[] {
	const guide = session.generatedGuide;
	if (!guide || guide.steps.length === 0) {
		return [];
	}

	const durationMs = Math.max(1000, options.defaultDurationMs ?? DEFAULT_STEP_DURATION_MS);
	const sortedSteps = [...guide.steps].sort((left, right) => left.order - right.order);
	const annotations: AnnotationRegion[] = [];

	for (const [index, step] of sortedSteps.entries()) {
		const candidate = findCandidate(step, index, session.candidates);
		const startMs = Math.max(0, Math.round(candidate?.timeMs ?? index * durationMs));
		const endMs = Math.max(startMs + 750, startMs + durationMs);
		const captionPosition = getCaptionPosition(candidate);

		annotations.push({
			id: options.nextId(),
			startMs,
			endMs,
			type: "text",
			content: buildCaption(step),
			textContent: buildCaption(step),
			position: captionPosition,
			size: { width: CAPTION_WIDTH, height: CAPTION_HEIGHT },
			style: {
				...DEFAULT_ANNOTATION_STYLE,
				color: "#f8fafc",
				backgroundColor: "rgba(15, 23, 42, 0.88)",
				fontSize: 18,
				fontWeight: "bold",
				textAlign: "left",
			},
			zIndex: options.nextZIndex(),
		});

		if (candidate?.position) {
			const magnifierPosition = getMagnifierPosition(captionPosition);
			const arrowPosition = getArrowPosition(candidate.position, magnifierPosition, {
				width: MAGNIFIER_SIZE,
				height: MAGNIFIER_SIZE,
			});
			const arrowDirection = getArrowDirection(candidate, arrowPosition, {
				width: ARROW_SIZE,
				height: ARROW_SIZE,
			});

			annotations.push({
				id: options.nextId(),
				startMs,
				endMs,
				type: "magnifier",
				content: buildCaption(step),
				position: magnifierPosition,
				size: { width: MAGNIFIER_SIZE, height: MAGNIFIER_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex: options.nextZIndex(),
				magnifierData: {
					...DEFAULT_MAGNIFIER_DATA,
					target: {
						x: candidate.position.normalizedX * 100,
						y: candidate.position.normalizedY * 100,
					},
					caption: candidate.targetText,
				},
			});
			annotations.push({
				id: options.nextId(),
				startMs,
				endMs,
				type: "figure",
				content: "",
				position: arrowPosition,
				size: { width: ARROW_SIZE, height: ARROW_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex: options.nextZIndex(),
				figureData: {
					...DEFAULT_FIGURE_DATA,
					arrowDirection,
					color: "#34B27B",
					strokeWidth: 5,
				},
			});
		}
	}

	return annotations;
}

export interface BuildGuideVideoSpeedRegionsOptions {
	nextId: () => string;
	durationMs?: number;
	speed?: number;
}

export function buildGuideVideoSpeedRegions(
	session: GuideSession,
	options: BuildGuideVideoSpeedRegionsOptions,
): SpeedRegion[] {
	const guide = session.generatedGuide;
	if (!guide || guide.steps.length === 0) {
		return [];
	}

	const durationMs = Math.max(
		100,
		Math.round(options.durationMs ?? DEFAULT_STEP_SLOW_MOTION_DURATION_MS),
	);
	const speed = options.speed ?? DEFAULT_STEP_SLOW_MOTION_SPEED;
	const sortedSteps = [...guide.steps].sort((left, right) => left.order - right.order);

	return sortedSteps.map((step, index) => {
		const candidate = findCandidate(step, index, session.candidates);
		const startMs = Math.max(0, Math.round(candidate?.timeMs ?? index * durationMs));
		return {
			id: options.nextId(),
			startMs,
			endMs: startMs + durationMs,
			speed,
		};
	});
}
