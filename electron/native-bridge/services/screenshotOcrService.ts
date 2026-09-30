import type { NativeImage } from "electron";
import type { ScreenshotOcrResult } from "../../../src/native/contracts";
import { ensureBundledOcrServiceRunning } from "../../guide/ocr/bundledOcrService";
import { normalizeOcrBlocks } from "../../ocr/normalizeOcrResponse";
import { decodeScreenshotDataUrl, MAX_SCREENSHOT_BYTES, ScreenshotError } from "./screenshotImage";
import { LocalTesseractOcrEngine } from "./tesseractOcrEngine";

const LOCAL_OCR_BASE_URL = "http://127.0.0.1:8866";
const OCR_REQUEST_TIMEOUT_MS = 120_000;

type OcrImage = Pick<NativeImage, "getSize" | "toPNG">;

export interface PrimaryScreenshotOcrEngine {
	recognize: (image: Buffer) => Promise<unknown>;
	dispose: () => Promise<void>;
}

export interface ScreenshotOcrServiceOptions {
	baseUrl?: string;
	timeoutMs?: number;
	decodeImage?: (dataUrl: unknown) => OcrImage;
	ensureServiceRunning?: (baseUrl?: string) => Promise<void>;
	fetchImpl?: typeof fetch;
	primaryEngine?: PrimaryScreenshotOcrEngine;
}

/**
 * Runs OCR with the cached, fully local Tesseract worker first and falls back
 * to OpenScreen's loopback-only bundled PaddleOCR service. Screenshot bytes
 * stay in memory and are never sent to an external endpoint.
 */
export class ScreenshotOcrService {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly decodeImage: (dataUrl: unknown) => OcrImage;
	private readonly ensureServiceRunning: (baseUrl?: string) => Promise<void>;
	private readonly fetchImpl: typeof fetch;
	private readonly primaryEngine: PrimaryScreenshotOcrEngine;

	constructor(options: ScreenshotOcrServiceOptions = {}) {
		this.baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? LOCAL_OCR_BASE_URL);
		this.timeoutMs = options.timeoutMs ?? OCR_REQUEST_TIMEOUT_MS;
		this.decodeImage = options.decodeImage ?? decodeScreenshotDataUrl;
		this.ensureServiceRunning = options.ensureServiceRunning ?? ensureBundledOcrServiceRunning;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.primaryEngine = options.primaryEngine ?? new LocalTesseractOcrEngine();
	}

	async recognizeText(dataUrl: unknown): Promise<ScreenshotOcrResult> {
		const image = this.decodeImage(dataUrl);
		const { width, height } = image.getSize();
		const png = image.toPNG();
		if (png.length === 0 || png.length > MAX_SCREENSHOT_BYTES) {
			throw new ScreenshotError(
				"INVALID_REQUEST",
				"The OCR image must be smaller than 64 MB after PNG conversion.",
			);
		}

		let primaryFailed = false;
		try {
			const payload = await this.primaryEngine.recognize(png);
			const blocks = createResultBlocks(payload, width, height);
			if (blocks.length > 0) {
				return { provider: "tesseract-local", blocks };
			}
		} catch {
			primaryFailed = true;
		}

		try {
			return await this.recognizeWithPaddle(png, width, height);
		} catch (fallbackError) {
			// An empty Tesseract result is valid (for example, a blank capture).
			// Do not turn it into an error only because the optional fallback is
			// unavailable. If Tesseract itself failed, surface the fallback error.
			if (!primaryFailed) {
				return { provider: "tesseract-local", blocks: [] };
			}
			throw fallbackError;
		}
	}

	dispose(): Promise<void> {
		return this.primaryEngine.dispose();
	}

	private async recognizeWithPaddle(
		png: Buffer,
		width: number,
		height: number,
	): Promise<ScreenshotOcrResult> {
		const imageBase64 = png.toString("base64");

		try {
			await this.ensureServiceRunning(this.baseUrl);
		} catch (error) {
			throw unavailableError(error);
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}/ocr`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					imageBase64,
					language: "vi,en",
					profile: "hybrid",
				}),
				signal: controller.signal,
			});
		} catch (error) {
			throw unavailableError(error);
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			throw new ScreenshotError(
				"UNAVAILABLE",
				`Local OCR service returned HTTP ${response.status}.`,
				response.status >= 500,
			);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new ScreenshotError(
				"UNAVAILABLE",
				"Local OCR service returned an invalid response.",
				true,
			);
		}

		return {
			provider: "paddleocr-local",
			blocks: createResultBlocks(payload, width, height),
		};
	}
}

function createResultBlocks(payload: unknown, width: number, height: number) {
	return normalizeOcrBlocks(payload, { width, height }).map((block, index) => ({
		...block,
		id: `ocr-${index + 1}`,
	}));
}

function normalizeLocalBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("The local OCR service URL is invalid.");
	}
	if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
		throw new Error("Screenshot OCR only supports the local PaddleOCR service.");
	}
	return url.toString().replace(/\/$/, "");
}

function unavailableError(error: unknown): ScreenshotError {
	const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
	return new ScreenshotError("UNAVAILABLE", `Local OCR service is unavailable.${detail}`, true);
}
