import path from "node:path";
import type { GuideRecordingIdInput } from "../../src/guide/contracts";

export const GUIDE_SESSION_SUFFIX = ".guide.json";
export const GUIDE_OUTPUT_DIR_SUFFIX = "-guide";

export interface GuidePaths {
	recordingId: string;
	baseName: string;
	baseDir: string;
	guidePath: string;
	outputDir: string;
}

export function normalizeGuideRecordingId(recordingId: GuideRecordingIdInput): string | null {
	if (typeof recordingId === "number") {
		return Number.isFinite(recordingId) ? String(Math.trunc(recordingId)) : null;
	}

	if (typeof recordingId !== "string") {
		return null;
	}

	const trimmed = recordingId.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function resolveGuidePaths(input: {
	recordingsDir: string;
	recordingId: GuideRecordingIdInput;
	videoPath?: string | null;
}): GuidePaths | null {
	const recordingId = normalizeGuideRecordingId(input.recordingId);
	if (!recordingId) {
		return null;
	}

	const normalizedVideoPath =
		typeof input.videoPath === "string" && input.videoPath.trim()
			? path.resolve(input.videoPath.trim())
			: null;
	const parsedVideoPath = normalizedVideoPath ? path.parse(normalizedVideoPath) : null;
	const baseName = parsedVideoPath?.name ?? defaultGuideBaseName(recordingId);
	const baseDir = parsedVideoPath?.dir ?? path.resolve(input.recordingsDir);

	return {
		recordingId,
		baseName,
		baseDir,
		guidePath: path.join(baseDir, `${baseName}${GUIDE_SESSION_SUFFIX}`),
		outputDir: path.join(baseDir, `${baseName}${GUIDE_OUTPUT_DIR_SUFFIX}`),
	};
}

function defaultGuideBaseName(recordingId: string): string {
	return recordingId.startsWith("recording-") ? recordingId : `recording-${recordingId}`;
}
