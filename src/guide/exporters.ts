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
		const screenshotPath = resolveStepScreenshotPath(step, session);
		if (screenshotPath) {
			lines.push(`![${escapeMarkdownAlt(step.title)}](${path.basename(screenshotPath)})`, "");
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
    .shot { display: inline-block; max-width: 100%; margin: 0; }
    img { display: block; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; }
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
	const screenshotPath = resolveStepScreenshotPath(step, session);
	const image = screenshotPath
		? `<figure class="shot"><img src="${escapeHtml(path.basename(screenshotPath))}" alt="${escapeHtml(step.title)}"></figure>`
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

function resolveStepScreenshotPath(
	step: GeneratedGuideStep,
	session: GuideSession,
): string | undefined {
	const snapshot = resolveStepSnapshot(step, session);
	return snapshot?.markedPath ?? step.screenshotPath ?? snapshot?.path;
}

function resolveStepSnapshot(step: GeneratedGuideStep, session: GuideSession) {
	const candidate = step.sourceCandidateId
		? session.candidates.find((item) => item.id === step.sourceCandidateId)
		: undefined;
	const screenshotFileName = step.screenshotPath ? path.basename(step.screenshotPath) : undefined;
	return (
		(candidate?.snapshotId
			? session.snapshots.find((item) => item.id === candidate.snapshotId)
			: undefined) ??
		(candidate?.eventId
			? session.snapshots.find((item) => item.eventId === candidate.eventId)
			: undefined) ??
		(screenshotFileName
			? session.snapshots.find(
					(item) =>
						path.basename(item.path) === screenshotFileName ||
						(item.markedPath ? path.basename(item.markedPath) === screenshotFileName : false),
				)
			: undefined)
	);
}
