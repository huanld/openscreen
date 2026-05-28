import type {
	GeneratedGuide,
	GeneratedGuideStep,
	GuideLanguage,
	GuideSession,
	GuideStepCandidate,
} from "./contracts";

export interface GuidePromptInput {
	session: GuideSession;
	candidates: GuideStepCandidate[];
	language: GuideLanguage;
}

export function buildGuideDraftPrompt(input: GuidePromptInput): string {
	const languageLabel = input.language === "vi" ? "Vietnamese" : "English";
	const candidatesJson = JSON.stringify(
		input.candidates.map((candidate, index) => ({
			order: index + 1,
			timeMs: Math.round(candidate.timeMs),
			action: candidate.action,
			targetText: candidate.targetText,
			targetRole: candidate.targetRole,
			nearbyText: candidate.nearbyText,
			confidence: candidate.confidence,
		})),
		null,
		2,
	);

	return [
		"You write software user guides from recorded UI interactions.",
		`Write the guide in ${languageLabel}.`,
		"Return JSON only with this shape:",
		'{"title":"...","summary":"...","steps":[{"id":"guide-step-1","order":1,"title":"...","instruction":"...","sourceCandidateId":"..."}]}',
		"Rules:",
		"- Use short, explicit step instructions.",
		"- Prefer visible target text from OCR when it is available.",
		"- Do not invent buttons or screens that are not in the candidates.",
		"- If a target is unclear, describe the action by screen position or timestamp.",
		"",
		"Candidates:",
		candidatesJson,
	].join("\n");
}

export function buildLocalGuideDraft(
	session: GuideSession,
	candidates: GuideStepCandidate[],
	language: GuideLanguage,
): GeneratedGuide {
	const sortedCandidates = [...candidates].sort((left, right) => left.timeMs - right.timeMs);
	const steps = sortedCandidates.map((candidate, index): GeneratedGuideStep => {
		const order = index + 1;
		return {
			id: `guide-step-${order}`,
			order,
			title: buildStepTitle(candidate, order, language),
			instruction: buildInstruction(candidate, language),
			screenshotPath: session.snapshots.find((snapshot) => snapshot.eventId === candidate.eventId)
				?.path,
			sourceCandidateId: candidate.id,
		};
	});

	return {
		title: language === "vi" ? "Hướng dẫn thao tác" : "User guide",
		summary:
			language === "vi"
				? "Tài liệu được tạo từ các thao tác đã ghi lại trên màn hình."
				: "Generated from recorded screen interactions.",
		steps,
	};
}

function buildStepTitle(
	candidate: GuideStepCandidate,
	order: number,
	language: GuideLanguage,
): string {
	if (candidate.targetText) {
		return language === "vi"
			? `Bước ${order}: ${candidate.targetText}`
			: `Step ${order}: ${candidate.targetText}`;
	}
	return language === "vi" ? `Bước ${order}` : `Step ${order}`;
}

function buildInstruction(candidate: GuideStepCandidate, language: GuideLanguage): string {
	const target = candidate.targetText;
	if (language === "vi") {
		if (target) {
			return `${candidate.action === "click" ? "Nhấn" : "Thực hiện thao tác"} vào "${target}".`;
		}
		return `Thực hiện thao tác tại mốc ${formatTimestamp(candidate.timeMs)}.`;
	}

	if (target) {
		return `${candidate.action === "click" ? "Click" : "Use"} "${target}".`;
	}
	return `Perform the action at ${formatTimestamp(candidate.timeMs)}.`;
}

function formatTimestamp(timeMs: number): string {
	const totalSeconds = Math.max(0, Math.round(timeMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
