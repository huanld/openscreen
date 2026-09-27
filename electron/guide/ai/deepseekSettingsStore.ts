import fs from "node:fs/promises";
import path from "node:path";
import type {
	GuideAiSettings,
	GuideOcrProfile,
	SaveGuideAiSettingsInput,
} from "../../../src/guide/contracts";

export interface DeepSeekGuideConfig {
	apiKey?: string;
	baseUrl: string;
	model: string;
}

export interface DeepSeekGuideConfigProvider {
	getDeepSeekConfig(): Promise<DeepSeekGuideConfig>;
}

export interface GuideOcrConfig {
	profile: GuideOcrProfile;
	language: string;
}

export interface GuideOcrConfigProvider {
	getOcrConfig(): Promise<GuideOcrConfig>;
}

interface PersistedGuideAiSettings {
	schemaVersion: 1;
	ocr?: {
		profile?: GuideOcrProfile;
		language?: string;
		updatedAt?: string;
	};
	deepseek?: {
		apiKeyEnvName?: string;
		baseUrl?: string;
		model?: string;
		updatedAt?: string;
	};
}

const DEFAULT_DEEPSEEK_API_KEY_ENV_NAME = "DEEPSEEK_API_KEY";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OCR_PROFILE: GuideOcrProfile = "vietnamese";
const DEFAULT_OCR_LANGUAGE = "vi,en";

export class DeepSeekSettingsStore implements DeepSeekGuideConfigProvider, GuideOcrConfigProvider {
	constructor(private readonly filePath: string) {}

	async getStatus(): Promise<GuideAiSettings> {
		const raw = await this.readSettings();
		const apiKeyEnvName = normalizeEnvName(raw?.deepseek?.apiKeyEnvName);
		const activeApiKey = process.env[apiKeyEnvName];

		return {
			ocr: {
				profile: normalizeOcrProfile(raw?.ocr?.profile ?? process.env.OPENSCREEN_GUIDE_OCR_PROFILE),
				language: normalizeOcrLanguage(
					raw?.ocr?.language ?? process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE,
				),
				updatedAt: raw?.ocr?.updatedAt,
			},
			deepseek: {
				hasApiKey: Boolean(activeApiKey),
				apiKeyEnvName,
				baseUrl: normalizeBaseUrl(raw?.deepseek?.baseUrl ?? process.env.DEEPSEEK_BASE_URL),
				model: normalizeModel(raw?.deepseek?.model ?? process.env.DEEPSEEK_MODEL),
				storage: activeApiKey ? "environment" : "none",
				encryptionAvailable: false,
				updatedAt: raw?.deepseek?.updatedAt,
			},
		};
	}

	async save(input: SaveGuideAiSettingsInput): Promise<GuideAiSettings> {
		const current = (await this.readSettings()) ?? { schemaVersion: 1 };
		const currentOcr = current.ocr ?? {};
		const currentDeepSeek = current.deepseek ?? {};
		const nextOcr = {
			...currentOcr,
			profile: normalizeOcrProfile(input.ocrProfile ?? currentOcr.profile),
			language: normalizeOcrLanguage(input.ocrLanguage ?? currentOcr.language),
			updatedAt: new Date().toISOString(),
		};
		const nextDeepSeek = {
			...currentDeepSeek,
			baseUrl: normalizeBaseUrl(input.baseUrl ?? currentDeepSeek.baseUrl),
			model: normalizeModel(input.model ?? currentDeepSeek.model),
			updatedAt: new Date().toISOString(),
		};

		if (input.clearDeepseekApiKeyEnvName) {
			delete nextDeepSeek.apiKeyEnvName;
		} else if (input.deepseekApiKeyEnvName !== undefined) {
			nextDeepSeek.apiKeyEnvName = normalizeEnvName(input.deepseekApiKeyEnvName);
		}

		await this.writeSettings({
			schemaVersion: 1,
			ocr: nextOcr,
			deepseek: nextDeepSeek,
		});
		return await this.getStatus();
	}

	async getDeepSeekConfig(): Promise<DeepSeekGuideConfig> {
		const raw = await this.readSettings();
		const apiKeyEnvName = normalizeEnvName(raw?.deepseek?.apiKeyEnvName);
		return {
			apiKey: process.env[apiKeyEnvName],
			baseUrl: normalizeBaseUrl(raw?.deepseek?.baseUrl ?? process.env.DEEPSEEK_BASE_URL),
			model: normalizeModel(raw?.deepseek?.model ?? process.env.DEEPSEEK_MODEL),
		};
	}

	async getOcrConfig(): Promise<GuideOcrConfig> {
		const raw = await this.readSettings();
		return {
			profile: normalizeOcrProfile(raw?.ocr?.profile ?? process.env.OPENSCREEN_GUIDE_OCR_PROFILE),
			language: normalizeOcrLanguage(
				raw?.ocr?.language ?? process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE,
			),
		};
	}

	private async readSettings(): Promise<PersistedGuideAiSettings | null> {
		try {
			const content = await fs.readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(content) as unknown;
			const normalized = normalizePersistedSettings(parsed);
			if (normalized && hasLegacyStoredSecret(parsed)) {
				await this.writeSettings(normalized);
			}
			return normalized;
		} catch {
			return null;
		}
	}

	private async writeSettings(settings: PersistedGuideAiSettings): Promise<void> {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), "utf-8");
		await fs.rename(tempPath, this.filePath);
	}
}

function hasLegacyStoredSecret(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		typeof (input as { deepseek?: { apiKey?: unknown } }).deepseek?.apiKey === "object"
	);
}

function normalizePersistedSettings(input: unknown): PersistedGuideAiSettings | null {
	if (!input || typeof input !== "object") {
		return null;
	}
	const raw = input as Partial<PersistedGuideAiSettings>;
	if (raw.schemaVersion !== 1) {
		return null;
	}
	return {
		schemaVersion: 1,
		ocr: {
			profile: normalizeOcrProfile(raw.ocr?.profile),
			language: normalizeOcrLanguage(raw.ocr?.language),
			updatedAt: raw.ocr?.updatedAt,
		},
		deepseek: {
			apiKeyEnvName: normalizeEnvName(raw.deepseek?.apiKeyEnvName),
			baseUrl: raw.deepseek?.baseUrl,
			model: raw.deepseek?.model,
			updatedAt: raw.deepseek?.updatedAt,
		},
	};
}

function normalizeEnvName(value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized) {
		return DEFAULT_DEEPSEEK_API_KEY_ENV_NAME;
	}
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
		? normalized
		: DEFAULT_DEEPSEEK_API_KEY_ENV_NAME;
}

function normalizeBaseUrl(value: string | undefined): string {
	const candidate = value?.trim() || DEFAULT_DEEPSEEK_BASE_URL;
	try {
		const url = new URL(candidate);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return DEFAULT_DEEPSEEK_BASE_URL;
		}
		return url.toString().replace(/\/$/, "");
	} catch {
		return DEFAULT_DEEPSEEK_BASE_URL;
	}
}

function normalizeModel(value: string | undefined): string {
	return value?.trim() || DEFAULT_DEEPSEEK_MODEL;
}

function normalizeOcrProfile(value: string | undefined): GuideOcrProfile {
	if (value === "fast" || value === "vietnamese" || value === "hybrid") {
		return value;
	}
	return DEFAULT_OCR_PROFILE;
}

function normalizeOcrLanguage(value: string | undefined): string {
	const normalized = value
		?.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
		.join(",");
	return normalized || DEFAULT_OCR_LANGUAGE;
}
