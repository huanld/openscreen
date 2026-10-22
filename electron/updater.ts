import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdateCheckResult, UpdateStatus } from "../src/lib/updateStatus";

const DEFAULT_UPDATE_FEED_URL =
	"https://gittea.softs.business/huanld/openscreen/raw/branch/release-assets%2Flatest";
const AUTO_CHECK_DELAY_MS = 10_000;
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let status: UpdateStatus = createStatus("idle");
let handlersRegistered = false;
let initialized = false;
let checkInFlight: Promise<UpdateCheckResult> | null = null;
const statusListeners = new Set<(status: UpdateStatus) => void>();
let installHandler: ((install: () => void) => void) | null = null;

function createStatus(
	phase: UpdateStatus["phase"],
	patch: Partial<UpdateStatus> = {},
): UpdateStatus {
	return {
		phase,
		currentVersion: app.getVersion(),
		updatedAt: new Date().toISOString(),
		...patch,
	};
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]): string | undefined {
	if (typeof releaseNotes === "string") {
		return releaseNotes;
	}
	if (Array.isArray(releaseNotes)) {
		return releaseNotes
			.map((note) => note.note)
			.filter(Boolean)
			.join("\n\n");
	}
	return undefined;
}

function updateStatus(next: UpdateStatus) {
	status = next;
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send("updates:status", status);
		}
	}
	for (const listener of statusListeners) {
		try {
			listener(status);
		} catch (error) {
			console.error("Update status listener failed:", error);
		}
	}
}

function statusFromInfo(phase: UpdateStatus["phase"], info: UpdateInfo): UpdateStatus {
	return createStatus(phase, {
		version: info.version,
		releaseName: info.releaseName ?? undefined,
		releaseNotes: normalizeReleaseNotes(info.releaseNotes),
	});
}

export function getUpdateStatus(): UpdateStatus {
	return status;
}

export function onUpdateStatusChanged(listener: (status: UpdateStatus) => void): () => void {
	statusListeners.add(listener);
	listener(status);
	return () => statusListeners.delete(listener);
}

export function setUpdateInstallHandler(handler: ((install: () => void) => void) | null): void {
	installHandler = handler;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
	if (!initialized) {
		updateStatus(
			createStatus("unsupported", {
				error: "Update service is not initialized.",
			}),
		);
		return { success: false, status, error: status.error };
	}

	if (!app.isPackaged && process.env.OPENSCREEN_ALLOW_DEV_UPDATE_CHECK !== "1") {
		updateStatus(
			createStatus("unsupported", {
				error: "Update checks only run in packaged builds.",
			}),
		);
		return { success: false, status, error: status.error };
	}

	if (checkInFlight) {
		return checkInFlight;
	}

	updateStatus(createStatus("checking"));
	checkInFlight = autoUpdater
		.checkForUpdates()
		.then(() => ({ success: true, status }))
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			updateStatus(createStatus("error", { error: message }));
			return { success: false, status, error: message };
		})
		.finally(() => {
			checkInFlight = null;
		});

	return checkInFlight;
}

export function installDownloadedUpdate(): UpdateCheckResult {
	if (status.phase !== "downloaded") {
		return {
			success: false,
			status,
			error: "No downloaded update is ready to install.",
		};
	}

	const install = () => {
		setImmediate(() => autoUpdater.quitAndInstall(false, true));
	};
	if (installHandler) {
		installHandler(install);
	} else {
		install();
	}
	return { success: true, status };
}

function registerUpdateIpcHandlers() {
	if (handlersRegistered) {
		return;
	}

	handlersRegistered = true;
	ipcMain.handle("updates:get-status", () => status);
	ipcMain.handle("updates:check", () => checkForUpdates());
	ipcMain.handle("updates:install", () => installDownloadedUpdate());
}

export function initializeAutoUpdates() {
	registerUpdateIpcHandlers();

	if (initialized) {
		return;
	}

	initialized = true;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowDowngrade = false;
	autoUpdater.disableWebInstaller = true;
	autoUpdater.logger = console;

	const feedUrl = process.env.OPENSCREEN_UPDATE_FEED_URL?.trim() || DEFAULT_UPDATE_FEED_URL;
	const updateToken = process.env.OPENSCREEN_UPDATE_TOKEN?.trim();
	if (updateToken) {
		autoUpdater.requestHeaders = {
			Authorization: `token ${updateToken}`,
		};
	}
	autoUpdater.setFeedURL({
		provider: "generic",
		url: feedUrl,
	});

	autoUpdater.on("checking-for-update", () => {
		updateStatus(createStatus("checking"));
	});
	autoUpdater.on("update-available", (info) => {
		updateStatus(statusFromInfo("available", info));
	});
	autoUpdater.on("update-not-available", (info) => {
		updateStatus(statusFromInfo("not-available", info));
	});
	autoUpdater.on("download-progress", (progress: ProgressInfo) => {
		updateStatus(
			createStatus("downloading", {
				version: status.version,
				releaseName: status.releaseName,
				releaseNotes: status.releaseNotes,
				percent: progress.percent,
				bytesPerSecond: progress.bytesPerSecond,
				transferred: progress.transferred,
				total: progress.total,
			}),
		);
	});
	autoUpdater.on("update-downloaded", (info) => {
		updateStatus(statusFromInfo("downloaded", info));
	});
	autoUpdater.on("error", (error) => {
		const message = error instanceof Error ? error.message : String(error);
		updateStatus(createStatus("error", { error: message }));
	});

	setTimeout(() => {
		void checkForUpdates();
	}, AUTO_CHECK_DELAY_MS);
	setInterval(() => {
		void checkForUpdates();
	}, AUTO_CHECK_INTERVAL_MS).unref();
}
