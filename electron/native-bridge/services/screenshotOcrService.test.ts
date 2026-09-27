import { describe, expect, it, vi } from "vitest";
import { ScreenshotError } from "./screenshotImage";
import { ScreenshotOcrService } from "./screenshotOcrService";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
}));

function decodedImage(width = 1000, height = 500) {
	return {
		getSize: () => ({ width, height }),
		toPNG: () => Buffer.from("normalized-png"),
	};
}

function response(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function primaryEngine(result: unknown = new Error("primary failed")) {
	return {
		recognize: vi.fn(async () => {
			if (result instanceof Error) throw result;
			return result;
		}),
		dispose: vi.fn(async () => undefined),
	};
}

describe("ScreenshotOcrService", () => {
	it("uses local Tesseract line boxes without starting the Paddle fallback", async () => {
		const primary = primaryEngine({
			blocks: [
				{
					text: "Chụp màn hình",
					confidence: 94,
					box: { x: 50, y: 25, width: 400, height: 50 },
				},
			],
		});
		const ensureServiceRunning = vi.fn(async () => undefined);
		const service = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primary,
			ensureServiceRunning,
			fetchImpl: vi.fn() as unknown as typeof fetch,
		});

		await expect(service.recognizeText("ignored")).resolves.toEqual({
			provider: "tesseract-local",
			blocks: [
				{
					id: "ocr-1",
					text: "Chụp màn hình",
					confidence: 0.94,
					box: { x: 0.05, y: 0.05, width: 0.4, height: 0.1 },
				},
			],
		});
		expect(ensureServiceRunning).not.toHaveBeenCalled();
	});

	it("sends normalized PNG bytes to the bundled hybrid OCR profile", async () => {
		const ensureServiceRunning = vi.fn(async () => undefined);
		const fetchImpl = vi.fn(async () =>
			response({
				blocks: [
					{
						text: "Xin chào",
						confidence: 0.96,
						box: { x: 100, y: 50, width: 300, height: 50 },
					},
				],
			}),
		);
		const service = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primaryEngine(),
			ensureServiceRunning,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(service.recognizeText("data:image/jpeg;base64,ignored")).resolves.toEqual({
			provider: "paddleocr-local",
			blocks: [
				{
					id: "ocr-1",
					text: "Xin chào",
					confidence: 0.96,
					box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
				},
			],
		});

		expect(ensureServiceRunning).toHaveBeenCalledWith("http://127.0.0.1:8866");
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("http://127.0.0.1:8866/ocr");
		expect(JSON.parse(String(init?.body))).toEqual({
			imageBase64: Buffer.from("normalized-png").toString("base64"),
			language: "vi,en",
			profile: "hybrid",
		});
	});

	it("returns an empty local result when no text is detected", async () => {
		const service = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primaryEngine(),
			ensureServiceRunning: async () => undefined,
			fetchImpl: vi.fn(async () => response({ blocks: [] })) as unknown as typeof fetch,
		});

		await expect(service.recognizeText("ignored")).resolves.toEqual({
			provider: "paddleocr-local",
			blocks: [],
		});
	});

	it("reports service startup and HTTP failures as retryable native errors", async () => {
		const startupFailure = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primaryEngine(),
			ensureServiceRunning: async () => {
				throw new Error("service did not start");
			},
			fetchImpl: vi.fn() as unknown as typeof fetch,
		});
		const startupError = await startupFailure.recognizeText("ignored").catch((error) => error);
		expect(startupError).toBeInstanceOf(ScreenshotError);
		expect(startupError).toMatchObject({ code: "UNAVAILABLE", retryable: true });

		const httpFailure = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primaryEngine(),
			ensureServiceRunning: async () => undefined,
			fetchImpl: vi.fn(async () => response({}, 503)) as unknown as typeof fetch,
		});
		const httpError = await httpFailure.recognizeText("ignored").catch((error) => error);
		expect(httpError).toMatchObject({ code: "UNAVAILABLE", retryable: true });
		expect(httpError.message).toContain("HTTP 503");
	});

	it("validates the screenshot data URL before starting OCR", async () => {
		const ensureServiceRunning = vi.fn(async () => undefined);
		const service = new ScreenshotOcrService({ ensureServiceRunning });

		const error = await service.recognizeText("not-an-image").catch((reason) => reason);
		expect(error).toMatchObject({ code: "INVALID_REQUEST" });
		expect(ensureServiceRunning).not.toHaveBeenCalled();
	});

	it("keeps a valid empty Tesseract result when the fallback is unavailable", async () => {
		const service = new ScreenshotOcrService({
			decodeImage: () => decodedImage(),
			primaryEngine: primaryEngine({ blocks: [] }),
			ensureServiceRunning: async () => {
				throw new Error("Paddle is not installed");
			},
		});

		await expect(service.recognizeText("ignored")).resolves.toEqual({
			provider: "tesseract-local",
			blocks: [],
		});
	});

	it("disposes the cached primary worker", async () => {
		const primary = primaryEngine({ blocks: [] });
		const service = new ScreenshotOcrService({ primaryEngine: primary });
		await service.dispose();
		expect(primary.dispose).toHaveBeenCalledOnce();
	});

	it("rejects non-loopback OCR endpoints", () => {
		expect(() => new ScreenshotOcrService({ baseUrl: "https://ocr.example.test" })).toThrow(
			/only supports the local/i,
		);
	});
});
