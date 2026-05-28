import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import type { GuideOcrProfile, GuideSnapshot, OcrBlock } from "../../../src/guide/contracts";
import { ensureBundledOcrServiceRunning } from "./bundledOcrService";

const execFileAsync = promisify(execFile);

export interface GuideOcrClient {
	recognize(snapshot: GuideSnapshot): Promise<OcrBlock[]>;
}

export interface GuideOcrClientConfig {
	profile: GuideOcrProfile;
	language: string;
}

interface PaddleOcrResponseBlock {
	text?: unknown;
	confidence?: unknown;
	score?: unknown;
	box?: unknown;
	bbox?: unknown;
}

export class PaddleOcrHttpClient implements GuideOcrClient {
	constructor(
		private readonly baseUrl = process.env.OPENSCREEN_GUIDE_OCR_URL ?? "http://127.0.0.1:8866",
		private readonly language = normalizeOcrLanguage(process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE),
		private readonly profile = normalizeOcrProfile(process.env.OPENSCREEN_GUIDE_OCR_PROFILE),
	) {}

	async recognize(snapshot: GuideSnapshot): Promise<OcrBlock[]> {
		await ensureBundledOcrServiceRunning(this.baseUrl);
		const imageBase64 = await fs.readFile(snapshot.path, "base64");
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/ocr`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					imageBase64,
					path: snapshot.path,
					language: this.language,
					profile: this.profile,
				}),
			});
		} catch (error) {
			throw new Error(
				`OCR service is unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (!response.ok) {
			throw new Error(`OCR service returned HTTP ${response.status}.`);
		}

		const payload = (await response.json()) as unknown;
		return normalizeOcrResponse(payload, snapshot);
	}
}

export class WindowsOcrClient implements GuideOcrClient {
	constructor(
		private readonly language = normalizeOcrLanguage(process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE),
	) {}

	async recognize(snapshot: GuideSnapshot): Promise<OcrBlock[]> {
		if (process.platform !== "win32") {
			throw new Error("Windows OCR fallback is only available on Windows.");
		}

		const script = buildWindowsOcrScript(snapshot.path, this.language);
		const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
		let stdout: string;
		try {
			const result = await execFileAsync(
				"powershell.exe",
				["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
				{
					maxBuffer: 8 * 1024 * 1024,
					timeout: 30000,
					windowsHide: true,
				},
			);
			stdout = result.stdout;
		} catch (error) {
			throw new Error(
				`Windows OCR failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		let payload: unknown;
		try {
			payload = parseWindowsOcrPayload(stdout);
		} catch (error) {
			throw new Error(
				`Windows OCR returned invalid JSON: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		return normalizeOcrResponse(payload, snapshot);
	}
}

export class DefaultGuideOcrClient implements GuideOcrClient {
	static fromConfig(config?: Partial<GuideOcrClientConfig>): DefaultGuideOcrClient {
		const normalizedConfig = normalizeOcrClientConfig(config);
		return new DefaultGuideOcrClient(
			new PaddleOcrHttpClient(undefined, normalizedConfig.language, normalizedConfig.profile),
			new WindowsOcrClient(normalizedConfig.language),
		);
	}

	constructor(
		private readonly httpClient = new PaddleOcrHttpClient(),
		private readonly windowsClient = new WindowsOcrClient(),
	) {}

	async recognize(snapshot: GuideSnapshot): Promise<OcrBlock[]> {
		try {
			return await this.httpClient.recognize(snapshot);
		} catch (httpError) {
			try {
				return await this.windowsClient.recognize(snapshot);
			} catch (fallbackError) {
				throw new Error(
					[
						httpError instanceof Error ? httpError.message : String(httpError),
						fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
					].join(" "),
				);
			}
		}
	}
}

function normalizeOcrClientConfig(
	config: Partial<GuideOcrClientConfig> | undefined,
): GuideOcrClientConfig {
	return {
		profile: normalizeOcrProfile(config?.profile ?? process.env.OPENSCREEN_GUIDE_OCR_PROFILE),
		language: normalizeOcrLanguage(config?.language ?? process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE),
	};
}

function normalizeOcrProfile(value: string | undefined): GuideOcrProfile {
	if (value === "fast" || value === "vietnamese" || value === "hybrid") {
		return value;
	}
	return "vietnamese";
}

function normalizeOcrLanguage(value: string | undefined): string {
	const normalized = value
		?.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
		.join(",");
	return normalized || "vi,en";
}

export function parseWindowsOcrPayload(stdout: string): unknown {
	const normalized = stdout.replace(/^\uFEFF/, "").trim();
	try {
		return JSON.parse(normalized);
	} catch {
		return JSON.parse(replaceRawJsonControlCharacters(normalized));
	}
}

function replaceRawJsonControlCharacters(value: string): string {
	let result = "";
	for (const character of value) {
		const code = character.charCodeAt(0);
		result += code < 32 || code === 127 ? " " : character;
	}
	return result;
}

export function normalizeOcrResponse(payload: unknown, snapshot: GuideSnapshot): OcrBlock[] {
	const rawBlocks = extractRawBlocks(payload);
	return rawBlocks
		.map((raw, index) => normalizeBlock(raw, snapshot, index))
		.filter((block): block is OcrBlock => block !== null);
}

function extractRawBlocks(payload: unknown): PaddleOcrResponseBlock[] {
	if (Array.isArray(payload)) {
		return payload as PaddleOcrResponseBlock[];
	}
	if (isRecord(payload)) {
		if (Array.isArray(payload.blocks)) {
			return payload.blocks as PaddleOcrResponseBlock[];
		}
		if (Array.isArray(payload.results)) {
			return payload.results as PaddleOcrResponseBlock[];
		}
		if (Array.isArray(payload.data)) {
			return payload.data as PaddleOcrResponseBlock[];
		}
	}
	return [];
}

function normalizeBlock(
	raw: PaddleOcrResponseBlock,
	snapshot: GuideSnapshot,
	index: number,
): OcrBlock | null {
	if (!isRecord(raw)) {
		return null;
	}
	const text = typeof raw.text === "string" ? raw.text.trim() : "";
	if (!text) {
		return null;
	}
	const confidence = normalizeConfidence(raw.confidence ?? raw.score);
	const box = normalizeBox(raw.box ?? raw.bbox, snapshot);
	if (!box) {
		return null;
	}

	return {
		id: `ocr-${snapshot.id}-${index + 1}`,
		snapshotId: snapshot.id,
		text,
		confidence,
		box,
	};
}

function normalizeConfidence(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0.5;
	}
	return value > 1 ? clamp01(value / 100) : clamp01(value);
}

function normalizeBox(
	value: unknown,
	snapshot: GuideSnapshot,
): { x: number; y: number; width: number; height: number } | null {
	if (Array.isArray(value)) {
		return normalizeArrayBox(value, snapshot);
	}
	if (!isRecord(value)) {
		return null;
	}

	const x = normalizeNumber(value.x);
	const y = normalizeNumber(value.y);
	const width = normalizeNumber(value.width ?? value.w);
	const height = normalizeNumber(value.height ?? value.h);
	if (x === null || y === null || width === null || height === null) {
		return null;
	}
	return normalizeBoxDimensions({ x, y, width, height }, snapshot);
}

function normalizeArrayBox(
	value: unknown[],
	snapshot: GuideSnapshot,
): { x: number; y: number; width: number; height: number } | null {
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
			snapshot,
		);
	}
	if (numbers.length >= 4) {
		return normalizeBoxDimensions(
			{ x: numbers[0] ?? 0, y: numbers[1] ?? 0, width: numbers[2] ?? 0, height: numbers[3] ?? 0 },
			snapshot,
		);
	}
	return null;
}

function normalizeBoxDimensions(
	box: { x: number; y: number; width: number; height: number },
	snapshot: GuideSnapshot,
): { x: number; y: number; width: number; height: number } {
	const usesPixels =
		box.x > 1 ||
		box.y > 1 ||
		box.width > 1 ||
		box.height > 1 ||
		box.x + box.width > 1 ||
		box.y + box.height > 1;
	const scaleX = usesPixels ? snapshot.width : 1;
	const scaleY = usesPixels ? snapshot.height : 1;
	return {
		x: clamp01(box.x / scaleX),
		y: clamp01(box.y / scaleY),
		width: clamp01(box.width / scaleX),
		height: clamp01(box.height / scaleY),
	};
}

function normalizeNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function buildWindowsOcrScript(imagePath: string, language: string): string {
	const imagePathBase64 = Buffer.from(imagePath, "utf8").toString("base64");
	const languageBase64 = Buffer.from(language, "utf8").toString("base64");
	return `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$imagePath = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${imagePathBase64}"))
$languageSetting = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${languageBase64}"))

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
})[0]

function Await-WinRt($operation, [Type]$resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

function New-OcrEngine($languageSetting) {
  $languageTags = @()
  foreach ($item in $languageSetting.Split(",")) {
    $tag = $item.Trim()
    if ($tag -eq "vi") { $tag = "vi-VN" }
    if ($tag -eq "en") { $tag = "en-US" }
    if ($tag.Length -gt 0) { $languageTags += $tag }
  }

  foreach ($tag in $languageTags) {
    try {
      $language = [Windows.Globalization.Language]::new($tag)
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
      if ($null -ne $engine) { return $engine }
    } catch {}
  }

  $profileEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -ne $profileEngine) { return $profileEngine }
  return [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))
}

function Normalize-OcrText($value) {
  if ($null -eq $value) { return "" }
  $text = [string]$value
  $text = [System.Text.RegularExpressions.Regex]::Replace($text, "[\\x00-\\x1F\\x7F]", " ")
  return $text.Trim()
}

$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = New-OcrEngine $languageSetting
if ($null -eq $engine) { throw "No Windows OCR engine is available." }
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$blocks = @()
$index = 0
foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    $rect = $word.BoundingRect
    $text = Normalize-OcrText $word.Text
    if ($text.Length -gt 0) {
      $index += 1
      $blocks += [PSCustomObject]@{
        text = $text
        confidence = 0.75
        box = [PSCustomObject]@{
          x = [double]$rect.X
          y = [double]$rect.Y
          width = [double]$rect.Width
          height = [double]$rect.Height
        }
      }
    }
  }
}

[PSCustomObject]@{ blocks = $blocks } | ConvertTo-Json -Depth 6 -Compress
`;
}
