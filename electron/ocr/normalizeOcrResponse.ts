export interface OcrImageDimensions {
	width: number;
	height: number;
}

export interface NormalizedOcrBlock {
	text: string;
	confidence: number;
	box: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

interface RawOcrBlock {
	text?: unknown;
	confidence?: unknown;
	score?: unknown;
	box?: unknown;
	bbox?: unknown;
}

export function normalizeOcrBlocks(
	payload: unknown,
	image: OcrImageDimensions,
): NormalizedOcrBlock[] {
	return extractRawBlocks(payload)
		.map((raw) => normalizeBlock(raw, image))
		.filter((block): block is NormalizedOcrBlock => block !== null);
}

function extractRawBlocks(payload: unknown): RawOcrBlock[] {
	if (Array.isArray(payload)) return payload as RawOcrBlock[];
	if (isRecord(payload)) {
		if (Array.isArray(payload.blocks)) return payload.blocks as RawOcrBlock[];
		if (Array.isArray(payload.results)) return payload.results as RawOcrBlock[];
		if (Array.isArray(payload.data)) return payload.data as RawOcrBlock[];
	}
	return [];
}

function normalizeBlock(raw: RawOcrBlock, image: OcrImageDimensions): NormalizedOcrBlock | null {
	if (!isRecord(raw)) return null;
	const text = typeof raw.text === "string" ? raw.text.trim() : "";
	if (!text) return null;
	const box = normalizeBox(raw.box ?? raw.bbox, image);
	if (!box) return null;
	return {
		text,
		confidence: normalizeConfidence(raw.confidence ?? raw.score),
		box,
	};
}

function normalizeConfidence(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
	return value > 1 ? clamp01(value / 100) : clamp01(value);
}

function normalizeBox(value: unknown, image: OcrImageDimensions): NormalizedOcrBlock["box"] | null {
	if (Array.isArray(value)) return normalizeArrayBox(value, image);
	if (!isRecord(value)) return null;

	const x = normalizeNumber(value.x);
	const y = normalizeNumber(value.y);
	const width = normalizeNumber(value.width ?? value.w);
	const height = normalizeNumber(value.height ?? value.h);
	if (x === null || y === null || width === null || height === null) return null;
	return normalizeBoxDimensions({ x, y, width, height }, image);
}

function normalizeArrayBox(
	value: unknown[],
	image: OcrImageDimensions,
): NormalizedOcrBlock["box"] | null {
	const numbers = value.flat(2).filter((item): item is number => typeof item === "number");
	if (numbers.length >= 8) {
		const xs = [numbers[0], numbers[2], numbers[4], numbers[6]];
		const ys = [numbers[1], numbers[3], numbers[5], numbers[7]];
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		return normalizeBoxDimensions(
			{ x: minX, y: minY, width: maxX - minX, height: maxY - minY },
			image,
		);
	}
	if (numbers.length >= 4) {
		return normalizeBoxDimensions(
			{ x: numbers[0] ?? 0, y: numbers[1] ?? 0, width: numbers[2] ?? 0, height: numbers[3] ?? 0 },
			image,
		);
	}
	return null;
}

function normalizeBoxDimensions(
	box: NormalizedOcrBlock["box"],
	image: OcrImageDimensions,
): NormalizedOcrBlock["box"] | null {
	if (box.width <= 0 || box.height <= 0 || image.width <= 0 || image.height <= 0) return null;
	const usesPixels = box.x > 1 || box.y > 1 || box.width > 1 || box.height > 1;
	const scaleX = usesPixels ? image.width : 1;
	const scaleY = usesPixels ? image.height : 1;
	const x = clamp01(box.x / scaleX);
	const y = clamp01(box.y / scaleY);
	return {
		x: roundCoordinate(x),
		y: roundCoordinate(y),
		width: roundCoordinate(Math.min(1 - x, clamp01(box.width / scaleX))),
		height: roundCoordinate(Math.min(1 - y, clamp01(box.height / scaleY))),
	};
}

function roundCoordinate(value: number): number {
	return Number(value.toFixed(12));
}

function normalizeNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
