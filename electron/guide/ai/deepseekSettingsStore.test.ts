import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeepSeekSettingsStore } from "./deepseekSettingsStore";

const tempDirs: string[] = [];
const originalOcrProfile = process.env.OPENSCREEN_GUIDE_OCR_PROFILE;
const originalOcrLanguage = process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE;

beforeEach(() => {
	delete process.env.OPENSCREEN_GUIDE_OCR_PROFILE;
	delete process.env.OPENSCREEN_GUIDE_OCR_LANGUAGE;
});

afterEach(async () => {
	restoreEnv("OPENSCREEN_GUIDE_OCR_PROFILE", originalOcrProfile);
	restoreEnv("OPENSCREEN_GUIDE_OCR_LANGUAGE", originalOcrLanguage);
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

async function createStore(): Promise<DeepSeekSettingsStore> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openscreen-guide-settings-"));
	tempDirs.push(dir);
	return new DeepSeekSettingsStore(path.join(dir, "guide-ai-settings.json"));
}

describe("DeepSeekSettingsStore OCR settings", () => {
	it("defaults to the Vietnamese enhanced OCR profile", async () => {
		const store = await createStore();

		await expect(store.getOcrConfig()).resolves.toEqual({
			profile: "vietnamese",
			language: "vi,en",
		});
	});

	it("persists OCR profile changes alongside DeepSeek settings", async () => {
		const store = await createStore();

		const status = await store.save({
			deepseekApiKeyEnvName: "DEEPSEEK_API_KEY",
			baseUrl: "https://api.deepseek.com",
			model: "deepseek-chat",
			ocrProfile: "hybrid",
			ocrLanguage: "vi,en",
		});

		expect(status.ocr).toMatchObject({
			profile: "hybrid",
			language: "vi,en",
		});
		await expect(store.getOcrConfig()).resolves.toEqual({
			profile: "hybrid",
			language: "vi,en",
		});
	});
});
