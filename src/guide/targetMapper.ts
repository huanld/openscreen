import type {
	GuideAction,
	GuideEvent,
	GuideSession,
	GuideStepCandidate,
	GuideTargetRole,
	OcrBlock,
} from "./contracts";

const DEFAULT_MAX_NEARBY_TEXT = 5;
const DEFAULT_CLICK_RADIUS = 0.18;
const TARGET_SCORE_THRESHOLD = 0.32;

interface TextRegion {
	text: string;
	confidence: number;
	box: OcrBlock["box"];
}

export interface BuildGuideStepCandidatesOptions {
	maxNearbyText?: number;
	clickRadius?: number;
}

export function buildGuideStepCandidates(
	session: GuideSession,
	options: BuildGuideStepCandidatesOptions = {},
): GuideStepCandidate[] {
	const maxNearbyText = Math.max(1, options.maxNearbyText ?? DEFAULT_MAX_NEARBY_TEXT);
	const clickRadius = Math.max(0.01, options.clickRadius ?? DEFAULT_CLICK_RADIUS);
	const snapshotsByEventId = new Map(
		session.snapshots.map((snapshot) => [snapshot.eventId, snapshot]),
	);
	const ocrBlocksBySnapshotId = groupOcrBlocksBySnapshot(session.ocrBlocks);

	return [...session.events]
		.sort((left, right) => left.timeMs - right.timeMs)
		.map((event): GuideStepCandidate => {
			const snapshot = snapshotsByEventId.get(event.id);
			const blocks = snapshot ? (ocrBlocksBySnapshotId.get(snapshot.id) ?? []) : [];
			const rankedRegions = rankTextRegionsForEvent(event, blocks, clickRadius);
			const targetRegion = rankedRegions.find(
				({ score }) => score >= TARGET_SCORE_THRESHOLD,
			)?.region;
			const nearbyText = uniqueText(rankedRegions.map(({ region }) => region.text)).slice(
				0,
				maxNearbyText,
			);
			const label = normalizeText(event.label);
			const targetText = label ?? normalizeText(targetRegion?.text);

			return {
				id: `candidate-${event.id}`,
				eventId: event.id,
				snapshotId: snapshot?.id,
				timeMs: event.timeMs,
				action: inferAction(event),
				targetText,
				targetRole: inferTargetRole(targetText),
				nearbyText,
				confidence: calculateCandidateConfidence(event, targetRegion, rankedRegions[0]?.score),
			};
		});
}

function groupOcrBlocksBySnapshot(ocrBlocks: OcrBlock[]): Map<string, OcrBlock[]> {
	const grouped = new Map<string, OcrBlock[]>();
	for (const block of ocrBlocks) {
		const existing = grouped.get(block.snapshotId) ?? [];
		existing.push(block);
		grouped.set(block.snapshotId, existing);
	}
	return grouped;
}

function rankTextRegionsForEvent(
	event: GuideEvent,
	blocks: OcrBlock[],
	clickRadius: number,
): Array<{ region: TextRegion; score: number }> {
	const click = getEventPoint(event);
	return buildTextRegions(blocks)
		.map((region) => ({ region, score: scoreRegion(region, click, clickRadius) }))
		.filter(({ region }) => normalizeText(region.text) !== undefined)
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.region.confidence - left.region.confidence ||
				right.region.text.length - left.region.text.length,
		);
}

function buildTextRegions(blocks: OcrBlock[]): TextRegion[] {
	const wordRegions = blocks
		.map((block): TextRegion | null => {
			const text = normalizeText(block.text);
			if (!text || !isUsefulOcrText(text)) {
				return null;
			}
			return {
				text,
				confidence: block.confidence,
				box: block.box,
			};
		})
		.filter((region): region is TextRegion => region !== null);
	const phraseRegions = buildPhraseRegions(wordRegions);
	return [...phraseRegions, ...wordRegions];
}

function buildPhraseRegions(regions: TextRegion[]): TextRegion[] {
	const sorted = [...regions].sort((left, right) => regionCenterY(left) - regionCenterY(right));
	const lines: TextRegion[][] = [];
	for (const region of sorted) {
		const centerY = regionCenterY(region);
		const line = lines.find(
			(candidate) =>
				Math.abs(regionCenterY(candidate[0]) - centerY) <=
				Math.max(0.012, averageHeight(candidate) * 0.9),
		);
		if (line) {
			line.push(region);
		} else {
			lines.push([region]);
		}
	}

	const phrases: TextRegion[] = [];
	for (const line of lines) {
		const segments = splitLineIntoSegments(line.sort((left, right) => left.box.x - right.box.x));
		for (const segment of segments) {
			if (segment.length < 2) {
				continue;
			}
			const phrase = mergeRegions(segment);
			if (phrase.text.length >= 3) {
				phrases.push(phrase);
			}
		}
	}
	return phrases;
}

function splitLineIntoSegments(line: TextRegion[]): TextRegion[][] {
	const segments: TextRegion[][] = [];
	let current: TextRegion[] = [];
	for (const region of line) {
		const previous = current.at(-1);
		if (
			previous &&
			region.box.x - (previous.box.x + previous.box.width) >
				Math.max(0.025, averageHeight(current) * 3)
		) {
			segments.push(current);
			current = [];
		}
		current.push(region);
	}
	if (current.length > 0) {
		segments.push(current);
	}
	return segments;
}

function mergeRegions(regions: TextRegion[]): TextRegion {
	const minX = Math.min(...regions.map((region) => region.box.x));
	const minY = Math.min(...regions.map((region) => region.box.y));
	const maxX = Math.max(...regions.map((region) => region.box.x + region.box.width));
	const maxY = Math.max(...regions.map((region) => region.box.y + region.box.height));
	return {
		text: regions.map((region) => region.text).join(" "),
		confidence:
			regions.reduce((total, region) => total + clamp01(region.confidence), 0) / regions.length,
		box: {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY,
		},
	};
}

function scoreRegion(
	region: TextRegion,
	click: { x: number; y: number } | null,
	clickRadius: number,
): number {
	if (!click) {
		return clamp01(region.confidence);
	}

	const centerX = region.box.x + region.box.width / 2;
	const centerY = region.box.y + region.box.height / 2;
	const distance = Math.hypot(centerX - click.x, centerY - click.y);
	const proximity = clamp01(1 - distance / clickRadius);
	const contains = pointInsideExpandedBox(click, region, 0.025) ? 0.35 : 0;
	return clamp01(
		proximity * 0.35 +
			clamp01(region.confidence) * 0.2 +
			contains +
			calculateTextQuality(region.text) * 0.2,
	);
}

function getEventPoint(event: GuideEvent): { x: number; y: number } | null {
	if (event.normalizedX !== undefined && event.normalizedY !== undefined) {
		return { x: clamp01(event.normalizedX), y: clamp01(event.normalizedY) };
	}
	if (
		event.x !== undefined &&
		event.y !== undefined &&
		event.x >= 0 &&
		event.x <= 1 &&
		event.y >= 0 &&
		event.y <= 1
	) {
		return { x: event.x, y: event.y };
	}
	return null;
}

function pointInsideExpandedBox(
	point: { x: number; y: number },
	region: Pick<TextRegion, "box">,
	padding: number,
): boolean {
	return (
		point.x >= region.box.x - padding &&
		point.x <= region.box.x + region.box.width + padding &&
		point.y >= region.box.y - padding &&
		point.y <= region.box.y + region.box.height + padding
	);
}

function inferAction(event: GuideEvent): GuideAction {
	if (event.kind === "click") {
		return "click";
	}
	return "manual";
}

function inferTargetRole(text: string | undefined): GuideTargetRole | undefined {
	if (!text) {
		return undefined;
	}

	const normalized = text.toLowerCase();
	if (
		/\b(ok|save|create|next|continue|login|submit|cancel|done|apply|open|start|finish)\b/.test(
			normalized,
		) ||
		/(lưu|tiếp|đăng nhập|hủy|áp dụng|mở|bắt đầu|hoàn tất)/i.test(text)
	) {
		return "button";
	}
	if (/\b(menu|file|edit|view|settings)\b/.test(normalized) || /(menu|cài đặt)/i.test(text)) {
		return "menu";
	}
	if (/\b(tab)\b/.test(normalized) || /(thẻ|tab)/i.test(text)) {
		return "tab";
	}
	if (/\b(search|name|email|password|input|field)\b/.test(normalized)) {
		return "field";
	}
	return "unknown";
}

function calculateCandidateConfidence(
	event: GuideEvent,
	targetRegion: TextRegion | undefined,
	score: number | undefined,
): number {
	if (targetRegion) {
		return roundConfidence(
			0.45 + clamp01(targetRegion.confidence) * 0.25 + clamp01(score ?? 0) * 0.3,
		);
	}
	if (event.label) {
		return 0.75;
	}
	if (getEventPoint(event)) {
		return 0.45;
	}
	return 0.3;
}

function uniqueText(values: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = normalizeText(value);
		if (!normalized) {
			continue;
		}
		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function normalizeText(value: string | undefined): string | undefined {
	const text = value?.replace(/\s+/g, " ").trim();
	return text ? text : undefined;
}

function isUsefulOcrText(text: string): boolean {
	if (!/[A-Za-z0-9À-ỹ]/.test(text)) {
		return false;
	}
	if (text.length === 1) {
		return false;
	}
	return true;
}

function calculateTextQuality(text: string): number {
	let score = 0.35;
	if (text.includes(" ")) {
		score += 0.5;
	}
	if (text.length >= 4) {
		score += 0.25;
	}
	if (/[�ï¿½]/.test(text)) {
		score -= 0.25;
	}
	if (/^[\W_]+$/.test(text)) {
		score -= 0.35;
	}
	return clamp01(score);
}

function regionCenterY(region: TextRegion): number {
	return region.box.y + region.box.height / 2;
}

function averageHeight(regions: TextRegion[]): number {
	return regions.reduce((total, region) => total + region.box.height, 0) / regions.length;
}

function roundConfidence(value: number): number {
	return Math.round(clamp01(value) * 100) / 100;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}
