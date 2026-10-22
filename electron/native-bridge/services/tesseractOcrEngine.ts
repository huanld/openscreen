import { access, copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import Tesseract from "tesseract.js";

const TESSERACT_LANGUAGES = ["vie", "eng"] as const;
const TESSERACT_MODEL_DIRECTORY = "tesseract-data";
const TESSERACT_MODEL_VERSION = "tesseract-v7-best-int";

interface TesseractBoundingBox {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

interface TesseractLine {
	text?: string;
	confidence?: number;
	bbox?: TesseractBoundingBox;
}

interface TesseractBlock {
	paragraphs?: Array<{
		lines?: TesseractLine[];
	}>;
}

export interface TesseractWorkerLike {
	recognize: (
		image: Buffer,
		options?: Record<string, unknown>,
		output?: Record<string, boolean>,
	) => Promise<{ data?: { blocks?: TesseractBlock[] | null } }>;
	setParameters: (parameters: Record<string, string>) => Promise<unknown>;
	terminate: () => Promise<unknown>;
}

export type TesseractWorkerFactory = (languageDirectory: string) => Promise<TesseractWorkerLike>;

export interface LocalTesseractOcrEngineOptions {
	createWorker?: TesseractWorkerFactory;
	resolveLanguageDirectory?: () => Promise<string>;
}

/**
 * Cached, serialized Tesseract worker for screenshot OCR. The worker receives
 * an explicit local language path, so it can never fall through to the CDN.
 */
export class LocalTesseractOcrEngine {
	private readonly createWorker: TesseractWorkerFactory;
	private readonly resolveLanguageDirectory: () => Promise<string>;
	private workerPromise: Promise<TesseractWorkerLike> | null = null;
	private recognitionQueue: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: LocalTesseractOcrEngineOptions = {}) {
		this.createWorker = options.createWorker ?? createLocalWorker;
		this.resolveLanguageDirectory =
			options.resolveLanguageDirectory ?? prepareTesseractLanguageDirectory;
	}

	recognize(image: Buffer): Promise<unknown> {
		const task = this.recognitionQueue.then(() => this.recognizeNow(image));
		this.recognitionQueue = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const pendingWorker = this.workerPromise;
		this.workerPromise = null;
		if (!pendingWorker) return;
		try {
			const worker = await pendingWorker;
			await worker.terminate();
		} catch {
			// A failed worker has no resources left to release.
		}
	}

	private async recognizeNow(image: Buffer): Promise<unknown> {
		if (this.disposed) {
			throw new Error("The local Tesseract OCR engine has been disposed.");
		}
		const worker = await this.getWorker();
		const result = await worker.recognize(
			image,
			{},
			{
				text: true,
				blocks: true,
			},
		);
		return { blocks: extractLineBlocks(result.data?.blocks) };
	}

	private getWorker(): Promise<TesseractWorkerLike> {
		if (!this.workerPromise) {
			this.workerPromise = this.resolveLanguageDirectory()
				.then((directory) => this.createWorker(directory))
				.catch((error) => {
					this.workerPromise = null;
					throw error;
				});
		}
		return this.workerPromise;
	}
}

function extractLineBlocks(blocks: TesseractBlock[] | null | undefined) {
	const lines = (blocks ?? []).flatMap((block) =>
		(block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []),
	);
	return lines.flatMap((line) => {
		const text = line.text?.trim();
		const box = line.bbox;
		if (!text || !box) return [];
		return [
			{
				text,
				confidence: line.confidence ?? 0,
				box: {
					x: box.x0,
					y: box.y0,
					width: box.x1 - box.x0,
					height: box.y1 - box.y0,
				},
			},
		];
	});
}

async function createLocalWorker(languageDirectory: string): Promise<TesseractWorkerLike> {
	const worker = await Tesseract.createWorker([...TESSERACT_LANGUAGES], Tesseract.OEM.LSTM_ONLY, {
		langPath: languageDirectory,
		workerPath: resolveTesseractWorkerPath(),
		// Explicitly load from langPath every time the process starts. This
		// avoids both CDN access and stale traineddata in a per-user cache.
		cacheMethod: "none",
	});
	await worker.setParameters({
		tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
		preserve_interword_spaces: "1",
	});
	return worker as TesseractWorkerLike;
}

async function prepareTesseractLanguageDirectory(): Promise<string> {
	if (app.isPackaged) {
		const directory = path.join(process.resourcesPath, TESSERACT_MODEL_DIRECTORY);
		await assertLanguageFiles(directory);
		return directory;
	}

	// The language packages live in separate directories during development,
	// while Tesseract requires all selected languages under one langPath.
	const directory = path.join(app.getPath("userData"), "ocr-runtime", TESSERACT_MODEL_VERSION);
	await mkdir(directory, { recursive: true });
	await Promise.all(
		TESSERACT_LANGUAGES.map(async (language) => {
			const source = resolveDevelopmentLanguageFile(language);
			const destination = path.join(directory, `${language}.traineddata.gz`);
			await copyWhenChanged(source, destination);
		}),
	);
	await assertLanguageFiles(directory);
	return directory;
}

function resolveDevelopmentLanguageFile(language: (typeof TESSERACT_LANGUAGES)[number]): string {
	const require = createRequire(import.meta.url);
	return require.resolve(
		`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,
	);
}

function resolveTesseractWorkerPath(): string {
	const require = createRequire(import.meta.url);
	const resolved = require.resolve("tesseract.js/src/worker-script/node/index.js");
	return app.isPackaged ? resolved.replace(/\.asar([/\\])/, ".asar.unpacked$1") : resolved;
}

async function copyWhenChanged(source: string, destination: string): Promise<void> {
	const sourceStats = await stat(source);
	try {
		const destinationStats = await stat(destination);
		if (sourceStats.size === destinationStats.size) return;
	} catch {
		// Missing or unreadable destination is replaced below.
	}
	await copyFile(source, destination);
}

async function assertLanguageFiles(directory: string): Promise<void> {
	await Promise.all(
		TESSERACT_LANGUAGES.map((language) =>
			access(path.join(directory, `${language}.traineddata.gz`)),
		),
	);
}
