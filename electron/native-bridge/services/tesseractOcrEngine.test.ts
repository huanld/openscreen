import { describe, expect, it, vi } from "vitest";
import { LocalTesseractOcrEngine, type TesseractWorkerLike } from "./tesseractOcrEngine";

vi.mock("electron", () => ({ app: {} }));

function workerWithResult(): TesseractWorkerLike {
	return {
		setParameters: vi.fn(async () => undefined),
		terminate: vi.fn(async () => undefined),
		recognize: vi.fn(async () => ({
			data: {
				blocks: [
					{
						paragraphs: [
							{
								lines: [
									{
										text: " Xin chào \n",
										confidence: 95,
										bbox: { x0: 10, y0: 20, x1: 110, y1: 50 },
									},
								],
							},
						],
					},
				],
			},
		})),
	};
}

describe("LocalTesseractOcrEngine", () => {
	it("caches one worker and returns line-level pixel boxes", async () => {
		const worker = workerWithResult();
		const createWorker = vi.fn(async () => worker);
		const resolveLanguageDirectory = vi.fn(async () => "C:\\local-models");
		const engine = new LocalTesseractOcrEngine({
			createWorker,
			resolveLanguageDirectory,
		});

		await expect(engine.recognize(Buffer.from("first"))).resolves.toEqual({
			blocks: [
				{
					text: "Xin chào",
					confidence: 95,
					box: { x: 10, y: 20, width: 100, height: 30 },
				},
			],
		});
		await engine.recognize(Buffer.from("second"));

		expect(resolveLanguageDirectory).toHaveBeenCalledOnce();
		expect(createWorker).toHaveBeenCalledOnce();
		expect(worker.recognize).toHaveBeenCalledTimes(2);
	});

	it("serializes recognition jobs on the shared worker", async () => {
		let finishFirst: (() => void) | undefined;
		const firstResult = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const worker = workerWithResult();
		const recognize = vi
			.fn()
			.mockImplementationOnce(async () => {
				await firstResult;
				return { data: { blocks: [] } };
			})
			.mockResolvedValueOnce({ data: { blocks: [] } });
		worker.recognize = recognize;
		const engine = new LocalTesseractOcrEngine({
			createWorker: async () => worker,
			resolveLanguageDirectory: async () => "C:\\local-models",
		});

		const first = engine.recognize(Buffer.from("first"));
		const second = engine.recognize(Buffer.from("second"));
		await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
		finishFirst?.();
		await Promise.all([first, second]);
		expect(recognize).toHaveBeenCalledTimes(2);
	});

	it("terminates the cached worker and rejects later jobs", async () => {
		const worker = workerWithResult();
		const engine = new LocalTesseractOcrEngine({
			createWorker: async () => worker,
			resolveLanguageDirectory: async () => "C:\\local-models",
		});
		await engine.recognize(Buffer.from("image"));

		await engine.dispose();

		expect(worker.terminate).toHaveBeenCalledOnce();
		await expect(engine.recognize(Buffer.from("late"))).rejects.toThrow(/disposed/i);
	});
});
