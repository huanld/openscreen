#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const controlUrl = process.env.OPENSCREEN_MCP_CONTROL_URL || "http://127.0.0.1:52347";
const token = process.env.OPENSCREEN_MCP_CONTROL_TOKEN;

async function callOpenScreen(action, payload = {}) {
	const response = await fetch(`${controlUrl.replace(/\/$/, "")}/mcp/${action}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(payload),
	});
	const result = await response.json().catch(() => ({
		success: false,
		error: `OpenScreen returned HTTP ${response.status}`,
	}));
	if (!response.ok || !result.success) {
		throw new Error(
			result.error || result.message || `OpenScreen returned HTTP ${response.status}`,
		);
	}
	return result;
}

function textResult(result) {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(result, null, 2),
			},
		],
	};
}

const server = new McpServer({
	name: "openscreen",
	version: "1.0.0",
});

server.registerTool(
	"list_sources",
	{
		title: "List OpenScreen capture sources",
		description: "List available screen and window sources that can be passed to record_video.",
		inputSchema: {},
	},
	async () => textResult(await callOpenScreen("list_sources")),
);

server.registerTool(
	"record_video",
	{
		title: "Start OpenScreen recording",
		description:
			"Start recording with a selected screen/window source, or the current/default source.",
		inputSchema: {
			guideMode: z.boolean().optional().describe("Enable Guide Mode for this recording."),
			sourceType: z
				.enum(["screen", "window"])
				.optional()
				.describe("Capture a screen/display or a window."),
			sourceId: z
				.string()
				.optional()
				.describe("Exact source id returned by list_sources, for example screen:0:0."),
			sourceName: z
				.string()
				.optional()
				.describe("Exact or partial source/window name to match when sourceId is not supplied."),
			displayIndex: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Zero-based display index for screen capture."),
		},
	},
	async (input) => textResult(await callOpenScreen("record_video", input)),
);

server.registerTool(
	"stop_recording",
	{
		title: "Stop OpenScreen recording",
		description: "Stop the active OpenScreen recording and return the saved video file URL.",
		inputSchema: {
			discard: z.boolean().optional().describe("Discard the recording instead of saving it."),
		},
	},
	async (input) => textResult(await callOpenScreen("stop_recording", input)),
);

server.registerTool(
	"export_video",
	{
		title: "Export OpenScreen video",
		description:
			"Export the currently loaded OpenScreen editor project and return the exported file URL.",
		inputSchema: {
			outputPath: z.string().optional().describe("Absolute output path. Defaults to Downloads."),
			format: z.enum(["mp4", "gif"]).optional().describe("Export format. Defaults to mp4."),
			quality: z.enum(["medium", "good", "source"]).optional().describe("MP4 quality preset."),
		},
	},
	async ({ outputPath, format, quality }) =>
		textResult(
			await callOpenScreen("export_video", {
				outputPath,
				settings: {
					format: format ?? "mp4",
					quality: quality ?? "good",
				},
			}),
		),
);

server.registerTool(
	"status",
	{
		title: "Get OpenScreen status",
		description: "Return whether OpenScreen is currently recording.",
		inputSchema: {},
	},
	async () => textResult(await callOpenScreen("status")),
);

await server.connect(new StdioServerTransport());
