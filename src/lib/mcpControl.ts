import type { ExportSettings } from "@/lib/exporter";

export type McpControlAction =
	| "list_sources"
	| "record_video"
	| "stop_recording"
	| "export_video"
	| "status";

export interface McpControlRequest {
	id: string;
	action: McpControlAction;
	payload?: unknown;
}

export interface McpRecordVideoPayload {
	guideMode?: boolean;
	sourceType?: "screen" | "window";
	sourceId?: string;
	sourceName?: string;
	displayIndex?: number;
}

export interface McpStopRecordingPayload {
	discard?: boolean;
}

export interface McpExportVideoPayload {
	outputPath?: string;
	settings?: Partial<ExportSettings>;
}

export interface McpControlResult {
	success: boolean;
	message?: string;
	recording?: boolean;
	path?: string;
	url?: string;
	data?: unknown;
	error?: string;
}

export function isMcpControlAction(value: unknown): value is McpControlAction {
	return (
		value === "list_sources" ||
		value === "record_video" ||
		value === "stop_recording" ||
		value === "export_video" ||
		value === "status"
	);
}
