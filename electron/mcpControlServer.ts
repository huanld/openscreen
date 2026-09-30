import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type BrowserWindow, ipcMain } from "electron";
import type { McpControlAction, McpControlRequest, McpControlResult } from "../src/lib/mcpControl";
import { isMcpControlAction } from "../src/lib/mcpControl";

const DEFAULT_MCP_CONTROL_PORT = 52347;
const MCP_CONTROL_REQUEST_TIMEOUT_MS = 120_000;

type GetWindow = () => BrowserWindow | null;

interface PendingMcpRequest {
	resolve: (result: McpControlResult) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

interface StartMcpControlServerOptions {
	getMainWindow: GetWindow;
	ensureWindow: (action: McpControlAction) => void;
}

const pendingRequests = new Map<string, PendingMcpRequest>();

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text ? JSON.parse(text) : {};
}

function withFileUrl(result: McpControlResult): McpControlResult {
	if (!result.success || result.url || !result.path) {
		return result;
	}

	return {
		...result,
		url: pathToFileURL(result.path).toString(),
	};
}

function resolveDefaultExportPath(payload: unknown) {
	if (
		!payload ||
		typeof payload !== "object" ||
		("outputPath" in payload && typeof payload.outputPath === "string" && payload.outputPath)
	) {
		return payload;
	}

	const requested = payload as { outputPath?: unknown; settings?: { format?: unknown } };
	const format = requested.settings?.format === "gif" ? "gif" : "mp4";
	const fileName = `openscreen-export-${Date.now()}.${format}`;
	return {
		...requested,
		outputPath: path.join(app.getPath("downloads"), fileName),
	};
}

function dispatchRendererRequest(
	window: BrowserWindow,
	action: McpControlAction,
	payload: unknown,
): Promise<McpControlResult> {
	return new Promise((resolve, reject) => {
		const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const timeout = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`Timed out waiting for renderer to handle ${action}`));
		}, MCP_CONTROL_REQUEST_TIMEOUT_MS);

		pendingRequests.set(id, { resolve, reject, timeout });
		const request: McpControlRequest = { id, action, payload };
		window.webContents.send("mcp-control-request", request);
	});
}

function registerMcpControlIpc() {
	ipcMain.on(
		"mcp-control-response",
		(_event, response: { id?: unknown; result?: McpControlResult }) => {
			if (typeof response.id !== "string") {
				return;
			}
			const pending = pendingRequests.get(response.id);
			if (!pending) {
				return;
			}
			clearTimeout(pending.timeout);
			pendingRequests.delete(response.id);
			pending.resolve(
				response.result ?? { success: false, error: "Renderer returned an empty result" },
			);
		},
	);
}

export function startMcpControlServer({
	getMainWindow,
	ensureWindow,
}: StartMcpControlServerOptions): Server {
	registerMcpControlIpc();

	const token = process.env.OPENSCREEN_MCP_CONTROL_TOKEN;
	const port = Number(process.env.OPENSCREEN_MCP_CONTROL_PORT) || DEFAULT_MCP_CONTROL_PORT;

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "GET" && url.pathname === "/health") {
				sendJson(response, 200, { success: true, app: "OpenScreen" });
				return;
			}

			if (request.method !== "POST" || !url.pathname.startsWith("/mcp/")) {
				sendJson(response, 404, { success: false, error: "Not found" });
				return;
			}

			if (token && request.headers.authorization !== `Bearer ${token}`) {
				sendJson(response, 401, { success: false, error: "Unauthorized" });
				return;
			}

			const action = url.pathname.slice("/mcp/".length);
			if (!isMcpControlAction(action)) {
				sendJson(response, 400, { success: false, error: `Unsupported MCP action: ${action}` });
				return;
			}

			const body = await readJsonBody(request);
			const payload = action === "export_video" ? resolveDefaultExportPath(body) : body;

			ensureWindow(action);
			const window = getMainWindow();
			if (!window || window.isDestroyed()) {
				sendJson(response, 503, { success: false, error: "OpenScreen window is not available" });
				return;
			}

			if (window.webContents.isLoading()) {
				await new Promise<void>((resolve) => {
					window.webContents.once("did-finish-load", () => resolve());
				});
			}

			const result = withFileUrl(await dispatchRendererRequest(window, action, payload));
			sendJson(response, result.success ? 200 : 409, result);
		} catch (error) {
			sendJson(response, 500, {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	server.listen(port, "127.0.0.1", () => {
		console.info(`[mcp-control] listening on http://127.0.0.1:${port}`);
	});
	server.on("error", (error) => {
		console.error("[mcp-control] failed to start:", error);
	});
	app.once("before-quit", () => {
		server.close();
	});

	return server;
}
