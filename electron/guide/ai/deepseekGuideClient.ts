import type {
	GeneratedGuide,
	GuideLanguage,
	GuideSession,
	GuideStepCandidate,
} from "../../../src/guide/contracts";
import { buildGuideDraftPrompt } from "../../../src/guide/promptBuilder";
import type { DeepSeekGuideConfigProvider } from "./deepseekSettingsStore";

export interface GuideDraftClient {
	generate(input: {
		session: GuideSession;
		candidates: GuideStepCandidate[];
		language: GuideLanguage;
	}): Promise<GeneratedGuide>;
}

export class DeepSeekGuideClientError extends Error {
	constructor(
		readonly code: "guide-ai-key-missing" | "guide-ai-request-failed" | "guide-ai-invalid-output",
		message: string,
		readonly retryable = false,
	) {
		super(message);
		this.name = "DeepSeekGuideClientError";
	}
}

interface DeepSeekChatResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

export class DeepSeekGuideClient implements GuideDraftClient {
	constructor(
		private readonly configProvider?: DeepSeekGuideConfigProvider,
		private readonly fallbackApiKey = process.env.DEEPSEEK_API_KEY,
		private readonly fallbackBaseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
		private readonly fallbackModel = process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
	) {}

	async generate(input: {
		session: GuideSession;
		candidates: GuideStepCandidate[];
		language: GuideLanguage;
	}): Promise<GeneratedGuide> {
		const config = await this.resolveConfig();
		if (!config.apiKey) {
			throw new DeepSeekGuideClientError(
				"guide-ai-key-missing",
				"DeepSeek API key is not configured.",
			);
		}

		let response: Response;
		try {
			response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${config.apiKey}`,
				},
				body: JSON.stringify({
					model: config.model,
					temperature: 0.2,
					response_format: { type: "json_object" },
					messages: [
						{
							role: "system",
							content:
								"You convert UI interaction telemetry into concise software user-guide steps.",
						},
						{
							role: "user",
							content: buildGuideDraftPrompt(input),
						},
					],
				}),
			});
		} catch (error) {
			throw new DeepSeekGuideClientError(
				"guide-ai-request-failed",
				`DeepSeek request failed: ${error instanceof Error ? error.message : String(error)}`,
				true,
			);
		}

		if (!response.ok) {
			throw new DeepSeekGuideClientError(
				"guide-ai-request-failed",
				`DeepSeek returned HTTP ${response.status}.`,
				true,
			);
		}

		const payload = (await response.json()) as DeepSeekChatResponse;
		const content = payload.choices?.[0]?.message?.content;
		if (!content) {
			throw new DeepSeekGuideClientError(
				"guide-ai-invalid-output",
				"DeepSeek returned an empty response.",
			);
		}
		return parseGeneratedGuide(content);
	}

	private async resolveConfig(): Promise<{ apiKey?: string; baseUrl: string; model: string }> {
		if (this.configProvider) {
			return await this.configProvider.getDeepSeekConfig();
		}
		return {
			apiKey: this.fallbackApiKey,
			baseUrl: this.fallbackBaseUrl,
			model: this.fallbackModel,
		};
	}
}

function parseGeneratedGuide(content: string): GeneratedGuide {
	try {
		const parsed = JSON.parse(stripCodeFence(content)) as unknown;
		const normalized = normalizeGeneratedGuide(parsed);
		if (!normalized) {
			throw new Error("Unexpected guide JSON shape.");
		}
		return normalized;
	} catch (error) {
		throw new DeepSeekGuideClientError(
			"guide-ai-invalid-output",
			`DeepSeek response is not valid guide JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function stripCodeFence(content: string): string {
	return content
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
}

function normalizeGeneratedGuide(value: unknown): GeneratedGuide | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const guide = value as Partial<GeneratedGuide>;
	if (typeof guide.title !== "string" || !Array.isArray(guide.steps)) {
		return null;
	}
	const steps = guide.steps
		.map((step, index) => {
			if (!step || typeof step !== "object") {
				return null;
			}
			const raw = step as Partial<GeneratedGuide["steps"][number]>;
			if (typeof raw.title !== "string" || typeof raw.instruction !== "string") {
				return null;
			}
			const order =
				typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : index + 1;
			return {
				id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `guide-step-${order}`,
				order,
				title: raw.title,
				instruction: raw.instruction,
				...(typeof raw.screenshotPath === "string" ? { screenshotPath: raw.screenshotPath } : {}),
				...(typeof raw.sourceCandidateId === "string"
					? { sourceCandidateId: raw.sourceCandidateId }
					: {}),
			};
		})
		.filter((step): step is GeneratedGuide["steps"][number] => step !== null);
	return {
		title: guide.title,
		summary: typeof guide.summary === "string" ? guide.summary : undefined,
		steps,
	};
}
