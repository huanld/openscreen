import path from "node:path";
import type { GeneratedGuideStep, GuideSession } from "./contracts";

export function exportGuideToMarkdown(session: GuideSession): string {
	const guide = requireGeneratedGuide(session);
	const lines = [`# ${guide.title}`, ""];
	if (guide.summary) {
		lines.push(guide.summary, "");
	}

	for (const step of guide.steps) {
		lines.push(`## ${step.order}. ${step.title}`, "", step.instruction, "");
		if (step.screenshotPath) {
			lines.push(`![${escapeMarkdownAlt(step.title)}](${path.basename(step.screenshotPath)})`, "");
		}
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

export function exportGuideToHtml(session: GuideSession): string {
	const guide = requireGeneratedGuide(session);
	const steps = guide.steps.map((step) => renderStepHtml(step, session)).join("\n");
	const summary = guide.summary ? `<p class="summary">${escapeHtml(guide.summary)}</p>` : "";
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(guide.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.55; margin: 32px; color: #111827; }
    main { max-width: 880px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .summary { color: #4b5563; margin: 0 0 28px; }
    .step { border-top: 1px solid #e5e7eb; padding: 22px 0; }
    .step h2 { font-size: 18px; margin: 0 0 8px; }
    .step p { margin: 0 0 12px; }
    .shot { display: inline-block; position: relative; max-width: 100%; margin: 0; }
    img { display: block; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; }
    .click-marker { position: absolute; width: 26px; height: 26px; border: 3px solid #ef4444; border-radius: 999px; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18), 0 2px 8px rgba(17, 24, 39, 0.28); transform: translate(-50%, -50%); pointer-events: none; }
    .click-marker::after { content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 999px; background: #ef4444; transform: translate(-50%, -50%); }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(guide.title)}</h1>
    ${summary}
    ${steps}
  </main>
</body>
</html>
`;
}

function renderStepHtml(step: GeneratedGuideStep, session: GuideSession): string {
	const clickPoint = resolveStepClickPoint(step, session);
	const marker = clickPoint
		? `<span class="click-marker" style="left: ${formatPercent(clickPoint.x)}%; top: ${formatPercent(clickPoint.y)}%;" aria-label="Click position"></span>`
		: "";
	const image = step.screenshotPath
		? `<figure class="shot"><img src="${escapeHtml(path.basename(step.screenshotPath))}" alt="${escapeHtml(step.title)}">${marker}</figure>`
		: "";
	return `<section class="step">
  <h2>${step.order}. ${escapeHtml(step.title)}</h2>
  <p>${escapeHtml(step.instruction)}</p>
  ${image}
</section>`;
}

function requireGeneratedGuide(session: GuideSession) {
	if (!session.generatedGuide) {
		throw new Error("Guide session does not have a generated guide.");
	}
	return session.generatedGuide;
}

function escapeMarkdownAlt(value: string): string {
	return value.replace(/[[\]]/g, "");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function resolveStepClickPoint(
	step: GeneratedGuideStep,
	session: GuideSession,
): { x: number; y: number } | null {
	const candidate = step.sourceCandidateId
		? session.candidates.find((item) => item.id === step.sourceCandidateId)
		: undefined;
	const eventId = candidate?.eventId;
	const event = eventId ? session.events.find((item) => item.id === eventId) : undefined;
	if (!event || (event.kind !== "click" && event.kind !== "hotkey")) {
		return null;
	}
	if (isNormalizedNumber(event.normalizedX) && isNormalizedNumber(event.normalizedY)) {
		return { x: clamp01(event.normalizedX), y: clamp01(event.normalizedY) };
	}

	const screenshotFileName = step.screenshotPath ? path.basename(step.screenshotPath) : undefined;
	const snapshot =
		(candidate?.snapshotId
			? session.snapshots.find((item) => item.id === candidate.snapshotId)
			: undefined) ??
		(screenshotFileName
			? session.snapshots.find((item) => path.basename(item.path) === screenshotFileName)
			: undefined);
	if (
		!snapshot ||
		typeof event.x !== "number" ||
		typeof event.y !== "number" ||
		snapshot.width <= 0 ||
		snapshot.height <= 0
	) {
		return null;
	}

	return {
		x: clamp01(event.x / snapshot.width),
		y: clamp01(event.y / snapshot.height),
	};
}

function formatPercent(value: number): string {
	return (clamp01(value) * 100).toFixed(2);
}

function isNormalizedNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
