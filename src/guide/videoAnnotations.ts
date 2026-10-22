import {
	type AnnotationRegion,
	type ArrowDirection,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_RECTANGLE_FIGURE_DATA,
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
const SPOTLIGHT_WIDTH = 24;
const SPOTLIGHT_HEIGHT = 18;
const ARROW_SIZE = 10;
const GUIDE_NODE_GAP_MS = 80;
const GUIDE_NODE_MERGE_WINDOW_MS = 400;
const GUIDE_NODE_MERGE_DISTANCE = 0.04;
const GUIDE_NODE_SAME_POINT_DISTANCE = 0.012;

interface GuideVideoNode {
	step: GeneratedGuideStep;
	candidate: GuideStepCandidate | undefined;
	nodeId: string;
	stepIndex: number;
	startMs: number;
}

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

function getGuideNodeId(step: GeneratedGuideStep, candidate: GuideStepCandidate | undefined) {
	return candidate?.id ?? step.sourceCandidateId?.trim() ?? step.id;
}

function getUniqueGuideNodes(session: GuideSession) {
	const sortedSteps = [...(session.generatedGuide?.steps ?? [])].sort(
		(left, right) => left.order - right.order,
	);
	const seenNodeIds = new Set<string>();

	return sortedSteps.flatMap((step, index) => {
		const candidate = findCandidate(step, index, session.candidates);
		const nodeId = getGuideNodeId(step, candidate);
		if (seenNodeIds.has(nodeId)) return [];
		seenNodeIds.add(nodeId);
		return [{ step, candidate, nodeId, stepIndex: index }];
	});
}

function getTimelineGuideNodes(
	session: GuideSession,
	fallbackDurationMs: number,
): GuideVideoNode[] {
	const timelineNodes = getUniqueGuideNodes(session)
		.map(
			(node): GuideVideoNode => ({
				...node,
				startMs: Math.max(
					0,
					Math.round(node.candidate?.timeMs ?? node.stepIndex * fallbackDurationMs),
				),
			}),
		)
		.sort(
			(left, right) =>
				left.startMs - right.startMs ||
				left.step.order - right.step.order ||
				left.stepIndex - right.stepIndex,
		);

	const collapsed: GuideVideoNode[] = [];
	for (const node of timelineNodes) {
		const previous = collapsed.at(-1);
		if (previous && shouldMergeNearbyGuideNodes(previous, node)) continue;
		collapsed.push(node);
	}
	for (let index = 1; index < collapsed.length; index += 1) {
		collapsed[index].startMs = Math.max(collapsed[index].startMs, collapsed[index - 1].startMs + 2);
	}
	return collapsed;
}

function shouldMergeNearbyGuideNodes(previous: GuideVideoNode, next: GuideVideoNode): boolean {
	const previousPosition = previous.candidate?.position;
	const nextPosition = next.candidate?.position;
	if (!previousPosition || !nextPosition) return false;
	if (next.startMs - previous.startMs > GUIDE_NODE_MERGE_WINDOW_MS) return false;

	const distance = Math.hypot(
		nextPosition.normalizedX - previousPosition.normalizedX,
		nextPosition.normalizedY - previousPosition.normalizedY,
	);
	const previousTarget = previous.candidate?.targetText?.trim().toLocaleLowerCase();
	const nextTarget = next.candidate?.targetText?.trim().toLocaleLowerCase();
	const sameTarget = Boolean(previousTarget && nextTarget && previousTarget === nextTarget);
	return (
		distance <= GUIDE_NODE_SAME_POINT_DISTANCE ||
		(sameTarget && distance <= GUIDE_NODE_MERGE_DISTANCE)
	);
}

function getNodeEndMs(nodes: GuideVideoNode[], index: number, durationMs: number): number {
	const startMs = nodes[index].startMs;
	const naturalEndMs = startMs + durationMs;
	const nextStartMs = nodes[index + 1]?.startMs;
	if (nextStartMs === undefined || nextStartMs >= naturalEndMs) return naturalEndMs;

	const spacingMs = Math.max(1, nextStartMs - startMs);
	const gapMs = Math.min(GUIDE_NODE_GAP_MS, Math.max(1, Math.floor(spacingMs / 2)));
	return Math.max(startMs + 1, nextStartMs - gapMs);
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

function getSpotlightPosition(position: NonNullable<GuideStepCandidate["position"]>) {
	const targetX = position.normalizedX * 100;
	const targetY = position.normalizedY * 100;
	return {
		x: clamp(targetX - SPOTLIGHT_WIDTH / 2, 2, 100 - SPOTLIGHT_WIDTH - 2),
		y: clamp(targetY - SPOTLIGHT_HEIGHT / 2, 2, 100 - SPOTLIGHT_HEIGHT - 2),
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
	const annotations: AnnotationRegion[] = [];
	const nodes = getTimelineGuideNodes(session, durationMs);

	for (const [nodeIndex, { step, candidate, nodeId, startMs }] of nodes.entries()) {
		const endMs = getNodeEndMs(nodes, nodeIndex, durationMs);
		const captionPosition = getCaptionPosition(candidate);
		let arrowPosition: { x: number; y: number } | null = null;
		let arrowDirection: ArrowDirection | null = null;

		if (candidate?.position) {
			const spotlightPosition = getSpotlightPosition(candidate.position);
			arrowPosition = getArrowPosition(candidate.position, captionPosition, {
				width: CAPTION_WIDTH,
				height: CAPTION_HEIGHT,
			});
			arrowDirection = getArrowDirection(candidate, arrowPosition, {
				width: ARROW_SIZE,
				height: ARROW_SIZE,
			});
			annotations.push({
				id: options.nextId(),
				startMs,
				endMs,
				type: "rectangle",
				content: "",
				position: spotlightPosition,
				size: { width: SPOTLIGHT_WIDTH, height: SPOTLIGHT_HEIGHT },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex: options.nextZIndex(),
				figureData: {
					...DEFAULT_RECTANGLE_FIGURE_DATA,
					strokeWidth: 4,
				},
				guideRecordingId: session.recordingId,
				guideNodeId: nodeId,
				guideRole: "rectangle",
			});
		}

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
			guideRecordingId: session.recordingId,
			guideNodeId: nodeId,
			guideRole: "text",
		});

		if (candidate?.position && arrowPosition && arrowDirection) {
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
				guideRecordingId: session.recordingId,
				guideNodeId: nodeId,
				guideRole: "arrow",
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
	const nodes = getTimelineGuideNodes(session, durationMs);
	return nodes.map(({ nodeId, startMs }, nodeIndex) => {
		return {
			id: options.nextId(),
			startMs,
			endMs: getNodeEndMs(nodes, nodeIndex, durationMs),
			speed,
			guideRecordingId: session.recordingId,
			guideNodeId: nodeId,
		};
	});
}

export function replaceGuideVideoAnnotations(
	existing: AnnotationRegion[],
	generated: AnnotationRegion[],
	recordingId: string,
): AnnotationRegion[] {
	return [
		...existing.filter(
			(annotation) =>
				annotation.guideRecordingId !== recordingId &&
				!generated.some((replacement) => isLegacyGuideAnnotationMatch(annotation, replacement)),
		),
		...generated,
	];
}

function isLegacyGuideAnnotationMatch(
	existing: AnnotationRegion,
	replacement: AnnotationRegion,
): boolean {
	if (existing.guideRecordingId !== undefined || existing.type !== replacement.type) return false;
	if (existing.startMs !== replacement.startMs) return false;
	if (
		Math.abs(existing.position.x - replacement.position.x) > 0.001 ||
		Math.abs(existing.position.y - replacement.position.y) > 0.001 ||
		Math.abs(existing.size.width - replacement.size.width) > 0.001 ||
		Math.abs(existing.size.height - replacement.size.height) > 0.001
	) {
		return false;
	}
	if (replacement.guideRole === "text") {
		return existing.content === replacement.content;
	}
	return (
		existing.figureData?.color === replacement.figureData?.color &&
		existing.figureData?.strokeWidth === replacement.figureData?.strokeWidth &&
		existing.figureData?.arrowDirection === replacement.figureData?.arrowDirection
	);
}

export function replaceGuideVideoSpeedRegions(
	existing: SpeedRegion[],
	generated: SpeedRegion[],
	recordingId: string,
): SpeedRegion[] {
	return [...existing.filter((region) => region.guideRecordingId !== recordingId), ...generated];
}
