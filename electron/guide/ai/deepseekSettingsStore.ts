import fs from "node:fs/promises";
import path from "node:path";
import type { GuideAiSettings, SaveGuideAiSettingsInput } from "../../../src/guide/contracts";

export interface DeepSeekGuideConfig {
	apiKey?: string;
	baseUrl: string;
	model: string;
}

export interface DeepSeekGuideConfigProvider {
	getDeepSeekConfig(): Promise<DeepSeekGuideConfig>;
}

interface PersistedGuideAiSettings {
	schemaVersion: 1;
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

export class DeepSeekSettingsStore implements DeepSeekGuideConfigProvider {
	constructor(private readonly filePath: string) {}

	async getStatus(): Promise<GuideAiSettings> {
		const raw = await this.readSettings();
		const apiKeyEnvName = normalizeEnvName(raw?.deepseek?.apiKeyEnvName);
		const activeApiKey = process.env[apiKeyEnvName];

		return {
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
		const currentDeepSeek = current.deepseek ?? {};
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
