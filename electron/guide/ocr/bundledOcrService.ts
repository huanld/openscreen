import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const DEFAULT_OCR_BASE_URL = "http://127.0.0.1:8866";
const DEFAULT_OCR_PORT = "8866";
const SERVICE_EXE_NAME = "openscreen-ocr-service.exe";
const HEALTH_TIMEOUT_MS = 1000;
const STARTUP_TIMEOUT_MS = 90000;
const PADDLEX_MODEL_NAMES = ["PP-OCRv5_mobile_det", "latin_PP-OCRv5_mobile_rec"];

let ocrProcess: ChildProcessWithoutNullStreams | null = null;
let startupPromise: Promise<void> | null = null;
let quitHookRegistered = false;

export async function ensureBundledOcrServiceRunning(
	baseUrl = DEFAULT_OCR_BASE_URL,
): Promise<void> {
	if (!shouldManageOcrService(baseUrl)) {
		return;
	}
	if (await isOcrServiceHealthy(baseUrl, HEALTH_TIMEOUT_MS)) {
		return;
	}

	const executablePath = await findBundledOcrServiceExecutable();
	if (!executablePath) {
		return;
	}

	if (!startupPromise) {
		startupPromise = startAndWaitForOcrService(executablePath, baseUrl).finally(() => {
			startupPromise = null;
		});
	}
	await startupPromise;
}

function shouldManageOcrService(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		const hostname = url.hostname.toLowerCase();
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			(hostname === "127.0.0.1" || hostname === "localhost") &&
			(url.port === "" || url.port === DEFAULT_OCR_PORT)
		);
	} catch {
		return false;
	}
}

async function findBundledOcrServiceExecutable(): Promise<string | null> {
	const candidates = [
		process.env.OPENSCREEN_GUIDE_OCR_EXE,
		path.join(process.resourcesPath, "ocr-service", SERVICE_EXE_NAME),
		path.join(process.resourcesPath, "ocr-service", "openscreen-ocr-service", SERVICE_EXE_NAME),
		path.resolve(process.cwd(), "tools", "ocr", "dist", "openscreen-ocr-service", SERVICE_EXE_NAME),
	].filter(
		(candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
	);

	for (const candidate of candidates) {
		try {
			const stats = await fs.stat(candidate);
			if (stats.isFile()) {
				return candidate;
			}
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

async function startAndWaitForOcrService(executablePath: string, baseUrl: string): Promise<void> {
	const runtimePaths = await prepareOcrRuntimePaths();
	if (!ocrProcess || ocrProcess.exitCode !== null || ocrProcess.killed) {
		startOcrServiceProcess(executablePath, runtimePaths);
	}
	await waitForOcrServiceHealth(baseUrl, STARTUP_TIMEOUT_MS);
}

async function prepareOcrRuntimePaths(): Promise<{
	modelCachePath: string;
	paddlexCachePath: string;
}> {
	const modelCachePath = path.join(app.getPath("userData"), "ocr-models");
	const paddlexCachePath = path.join(modelCachePath, "paddlex");
	await seedBundledPaddlexModels(paddlexCachePath);
	return { modelCachePath, paddlexCachePath };
}

async function seedBundledPaddlexModels(destinationCachePath: string): Promise<void> {
	const sourceCachePath = await findBundledPaddlexModelCache();
	if (!sourceCachePath) {
		return;
	}

	const sourceOfficialModels = path.join(sourceCachePath, "official_models");
	const destinationOfficialModels = path.join(destinationCachePath, "official_models");
	await fs.mkdir(destinationOfficialModels, { recursive: true });

	for (const modelName of PADDLEX_MODEL_NAMES) {
		const sourceModelPath = path.join(sourceOfficialModels, modelName);
		const destinationModelPath = path.join(destinationOfficialModels, modelName);
		if (!(await pathExists(sourceModelPath)) || (await pathExists(destinationModelPath))) {
			continue;
		}
		await fs.cp(sourceModelPath, destinationModelPath, {
			recursive: true,
			errorOnExist: false,
			force: false,
		});
	}
}

async function findBundledPaddlexModelCache(): Promise<string | null> {
	const candidates = [
		path.join(process.resourcesPath, "ocr-models", "paddlex"),
		path.resolve(process.cwd(), "tools", "ocr", "models", "paddlex"),
	];
	for (const candidate of candidates) {
		try {
			const stats = await fs.stat(candidate);
			if (stats.isDirectory()) {
				return candidate;
			}
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

async function pathExists(value: string): Promise<boolean> {
	try {
		await fs.access(value);
		return true;
	} catch {
		return false;
	}
}

function startOcrServiceProcess(
	executablePath: string,
	runtimePaths: { modelCachePath: string; paddlexCachePath: string },
): void {
	registerQuitHook();
	ocrProcess = spawn(executablePath, [], {
		cwd: path.dirname(executablePath),
		env: {
			...process.env,
			OPENSCREEN_OCR_HOST: "127.0.0.1",
			OPENSCREEN_OCR_PORT: DEFAULT_OCR_PORT,
			PADDLEOCR_DEVICE: process.env.PADDLEOCR_DEVICE ?? "cpu",
			PADDLEOCR_ENABLE_MKLDNN: process.env.PADDLEOCR_ENABLE_MKLDNN ?? "0",
			PADDLEOCR_LANG: process.env.PADDLEOCR_LANG ?? "latin",
			PADDLEOCR_USE_MOBILE: process.env.PADDLEOCR_USE_MOBILE ?? "1",
			PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT: process.env.PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT ?? "False",
			PADDLE_PDX_CACHE_HOME: process.env.PADDLE_PDX_CACHE_HOME ?? runtimePaths.paddlexCachePath,
			PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:
				process.env.PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK ?? "True",
			PADDLE_HOME: process.env.PADDLE_HOME ?? path.join(runtimePaths.modelCachePath, "paddle"),
			PADDLEOCR_HOME:
				process.env.PADDLEOCR_HOME ?? path.join(runtimePaths.modelCachePath, "paddleocr"),
			PYTHONUTF8: "1",
		},
		windowsHide: true,
	});

	ocrProcess.stdout.on("data", (chunk) => {
		console.info(`[guide-ocr-service] ${chunk.toString().trim()}`);
	});
	ocrProcess.stderr.on("data", (chunk) => {
		console.warn(`[guide-ocr-service] ${chunk.toString().trim()}`);
	});
	ocrProcess.on("exit", (code, signal) => {
		console.info("[guide-ocr-service] exited", { code, signal });
		ocrProcess = null;
	});
}

function registerQuitHook(): void {
	if (quitHookRegistered) {
		return;
	}
	quitHookRegistered = true;
	app.once("before-quit", () => {
		const processToStop = ocrProcess;
		ocrProcess = null;
		processToStop?.kill();
	});
}

async function waitForOcrServiceHealth(baseUrl: string, timeoutMs: number): Promise<void> {
	const startedAt = Date.now();
	let lastError: unknown;
	while (Date.now() - startedAt < timeoutMs) {
		if (await isOcrServiceHealthy(baseUrl, HEALTH_TIMEOUT_MS)) {
			return;
		}
		if (ocrProcess?.exitCode !== null && ocrProcess?.exitCode !== undefined) {
			throw new Error(`Bundled OCR service exited with code ${ocrProcess.exitCode}.`);
		}
		await sleep(750);
	}
	if (lastError instanceof Error) {
		throw lastError;
	}
	throw new Error("Timed out waiting for bundled OCR service to start.");
}

async function isOcrServiceHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
