export type UpdateStatusPhase =
	| "idle"
	| "checking"
	| "available"
	| "not-available"
	| "downloading"
	| "downloaded"
	| "error"
	| "unsupported";

export interface UpdateStatus {
	phase: UpdateStatusPhase;
	currentVersion: string;
	version?: string;
	releaseName?: string;
	releaseNotes?: string;
	percent?: number;
	bytesPerSecond?: number;
	transferred?: number;
	total?: number;
	error?: string;
	updatedAt: string;
}

export interface UpdateCheckResult {
	success: boolean;
	status: UpdateStatus;
	error?: string;
}
