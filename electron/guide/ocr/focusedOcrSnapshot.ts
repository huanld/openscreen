import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GuideEvent, GuideSnapshot, OcrBlock } from "../../../src/guide/contracts";

const execFileAsync = promisify(execFile);

interface FocusTransform {
	cropX: number;
	cropY: number;
	cropWidth: number;
	cropHeight: number;
	originalWidth: number;
	originalHeight: number;
}

export interface FocusedOcrSnapshot {
	snapshot: GuideSnapshot;
	transform?: FocusTransform;
}

export async function createFocusedOcrSnapshot(input: {
	snapshot: GuideSnapshot;
	event?: GuideEvent;
	outputDir: string;
}): Promise<FocusedOcrSnapshot> {
	if (process.platform !== "win32") {
		return { snapshot: input.snapshot };
	}

	const click = getEventPoint(input.event, input.snapshot);
	if (!click) {
		return { snapshot: input.snapshot };
	}

	const crop = calculateFocusCrop(input.snapshot, click);
	if (
		!crop ||
		(crop.cropWidth === input.snapshot.width && crop.cropHeight === input.snapshot.height)
	) {
		return { snapshot: input.snapshot };
	}

	const focusDir = path.join(input.outputDir, "ocr-focus");
	await fs.mkdir(focusDir, { recursive: true });
	const focusPath = path.join(focusDir, `${path.parse(input.snapshot.path).name}-focus.png`);
	const zoom = 2;
	const focusedSnapshot: GuideSnapshot = {
		...input.snapshot,
		path: focusPath,
		width: crop.cropWidth * zoom,
		height: crop.cropHeight * zoom,
	};

	try {
		await writeFocusedPng({
			sourcePath: input.snapshot.path,
			outputPath: focusPath,
			cropX: crop.cropX,
			cropY: crop.cropY,
			cropWidth: crop.cropWidth,
			cropHeight: crop.cropHeight,
			outputWidth: focusedSnapshot.width,
			outputHeight: focusedSnapshot.height,
		});
		return { snapshot: focusedSnapshot, transform: crop };
	} catch {
		return { snapshot: input.snapshot };
	}
}

export function remapFocusedOcrBlocks(
	blocks: OcrBlock[],
	transform: FocusedOcrSnapshot["transform"],
): OcrBlock[] {
	if (!transform) {
		return blocks;
	}

	return blocks.map((block) => ({
		...block,
		box: {
			x: clamp01((transform.cropX + block.box.x * transform.cropWidth) / transform.originalWidth),
			y: clamp01((transform.cropY + block.box.y * transform.cropHeight) / transform.originalHeight),
			width: clamp01((block.box.width * transform.cropWidth) / transform.originalWidth),
			height: clamp01((block.box.height * transform.cropHeight) / transform.originalHeight),
		},
	}));
}

function getEventPoint(
	event: GuideEvent | undefined,
	snapshot: GuideSnapshot,
): { x: number; y: number } | null {
	if (!event) {
		return null;
	}
	if (isNormalizedNumber(event.normalizedX) && isNormalizedNumber(event.normalizedY)) {
		return { x: event.normalizedX, y: event.normalizedY };
	}
	if (isNormalizedNumber(event.x) && isNormalizedNumber(event.y)) {
		return { x: event.x, y: event.y };
	}
	if (
		typeof event.x === "number" &&
		typeof event.y === "number" &&
		event.x >= 0 &&
		event.y >= 0 &&
		event.x <= snapshot.width &&
		event.y <= snapshot.height
	) {
		return { x: clamp01(event.x / snapshot.width), y: clamp01(event.y / snapshot.height) };
	}
	return null;
}

function calculateFocusCrop(
	snapshot: GuideSnapshot,
	click: { x: number; y: number },
): FocusTransform | null {
	if (snapshot.width <= 0 || snapshot.height <= 0) {
		return null;
	}

	const cropWidth = clampInteger(
		Math.round(snapshot.width * 0.42),
		Math.min(360, snapshot.width),
		Math.min(720, snapshot.width),
	);
	const cropHeight = clampInteger(
		Math.round(snapshot.height * 0.42),
		Math.min(240, snapshot.height),
		Math.min(520, snapshot.height),
	);
	const clickX = Math.round(clamp01(click.x) * snapshot.width);
	const clickY = Math.round(clamp01(click.y) * snapshot.height);
	return {
		cropX: clampInteger(Math.round(clickX - cropWidth / 2), 0, snapshot.width - cropWidth),
		cropY: clampInteger(Math.round(clickY - cropHeight / 2), 0, snapshot.height - cropHeight),
		cropWidth,
		cropHeight,
		originalWidth: snapshot.width,
		originalHeight: snapshot.height,
	};
}

async function writeFocusedPng(input: {
	sourcePath: string;
	outputPath: string;
	cropX: number;
	cropY: number;
	cropWidth: number;
	cropHeight: number;
	outputWidth: number;
	outputHeight: number;
}): Promise<void> {
	const script = buildCropScript(input);
	const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
	await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
		{
			timeout: 30000,
			maxBuffer: 1024 * 1024,
			windowsHide: true,
		},
	);
}

function buildCropScript(input: {
	sourcePath: string;
	outputPath: string;
	cropX: number;
	cropY: number;
	cropWidth: number;
	cropHeight: number;
	outputWidth: number;
	outputHeight: number;
}): string {
	const sourcePathBase64 = Buffer.from(input.sourcePath, "utf8").toString("base64");
	const outputPathBase64 = Buffer.from(input.outputPath, "utf8").toString("base64");
	return `
$ErrorActionPreference = "Stop"
$sourcePath = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${sourcePathBase64}"))
$outputPath = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${outputPathBase64}"))
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile($sourcePath)
$target = [System.Drawing.Bitmap]::new(${input.outputWidth}, ${input.outputHeight})
$graphics = [System.Drawing.Graphics]::FromImage($target)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sourceRect = [System.Drawing.Rectangle]::new(${input.cropX}, ${input.cropY}, ${input.cropWidth}, ${input.cropHeight})
  $targetRect = [System.Drawing.Rectangle]::new(0, 0, ${input.outputWidth}, ${input.outputHeight})
  $graphics.DrawImage($source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $target.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $target.Dispose()
  $source.Dispose()
}
`;
}

function isNormalizedNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampInteger(value: number, min: number, max: number): number {
	if (max < min) {
		return min;
	}
	return Math.round(Math.min(max, Math.max(min, value)));
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}
