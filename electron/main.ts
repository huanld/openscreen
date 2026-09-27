import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	globalShortcut,
	ipcMain,
	Menu,
	Notification,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { mainT, setMainLocale } from "./i18n";
import { getSelectedDesktopSource, registerIpcHandlers } from "./ipc/handlers";
import { startMcpControlServer } from "./mcpControlServer";
import {
	checkForUpdates,
	getUpdateStatus,
	initializeAutoUpdates,
	installDownloadedUpdate,
	onUpdateStatusChanged,
	setUpdateInstallHandler,
} from "./updater";
import {
	createCountdownOverlayWindow,
	createEditorWindow,
	createHudOverlayWindow,
	createScreenshotWindow,
	createSourceSelectorWindow,
	prewarmScreenshotWindow,
} from "./windows";
import { ensureWindowsAutoStart, shouldStartInTray } from "./windowsStartup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isPrimaryInstance = app.requestSingleInstanceLock();
const startsInTray = shouldStartInTray(process.argv, process.platform);
const SCREENSHOT_REGION_SHORTCUT = "CommandOrControl+R";
const SCREENSHOT_REGION_SHORTCUT_RETRY_MS = 30_000;
let applicationInitialized: Promise<void> | null = null;
let screenshotRegionShortcutRegistered = false;
let screenshotRegionShortcutRetry: ReturnType<typeof setInterval> | null = null;
let screenshotRegionShortcutInitialized = false;
let screenshotRegionShortcutWarned = false;
let lastScreenshotRegionShortcutAt = 0;

if (!isPrimaryInstance) {
	app.quit();
}

// Use Screen & System Audio Recording permissions instead of CoreAudio Tap API on macOS.
// CoreAudio Tap requires NSAudioCaptureUsageDescription in the parent app's Info.plist,
// which doesn't work when running from a terminal/IDE during development, makes my life easier
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

// Enable Wayland support for proper screen capture and window management
// on Wayland compositors (Hyprland, GNOME, KDE, etc.)
if (process.platform === "linux") {
	const isWayland =
		process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== undefined;
	if (isWayland) {
		app.commandLine.appendSwitch("ozone-platform", "wayland");
		// Enable WebRTCPipeWireCapturer for screen capture on Wayland
		app.commandLine.appendSwitch("enable-features", "WaylandWindowDrag,WebRTCPipeWireCapturer");
	}
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let countdownOverlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Remembered so a tray rebuilt after a screenshot keeps the recording state.
let trayShowsRecording = false;
let selectedSourceName = "";
const isMac = process.platform === "darwin";
const trayIconSize = isMac ? 16 : 24;

// Tray Icons
const defaultTrayIcon = getTrayIcon("openscreen.png", trayIconSize);
const recordingTrayIcon = getTrayIcon("rec-button.png", trayIconSize);

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function showMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
		return;
	}

	createWindow();
}

function sendScreenshotRegionShortcut(window: BrowserWindow) {
	if (window.isDestroyed() || window.webContents.isDestroyed()) return;
	window.webContents.send("screenshot:capture-region-shortcut");
}

function triggerScreenshotRegionShortcut() {
	const triggeredAt = Date.now();
	if (triggeredAt - lastScreenshotRegionShortcutAt < 350) return;
	lastScreenshotRegionShortcutAt = triggeredAt;
	if (trayShowsRecording) {
		console.warn("[screenshot] Ctrl+R ignored while a recording is active");
		return;
	}
	const screenshotWindow = createScreenshotWindow({ showOnReady: false });
	const dispatch = () => {
		if (screenshotWindow.isDestroyed() || screenshotWindow.webContents.isDestroyed()) return;
		if (isWindowDirty(screenshotWindow)) {
			if (process.env["HEADLESS"] !== "true") {
				if (screenshotWindow.isMinimized()) screenshotWindow.restore();
				screenshotWindow.show();
				screenshotWindow.focus();
			}
			screenshotWindow.webContents.send("screenshot:capture-region-shortcut-blocked");
			return;
		}
		sendScreenshotRegionShortcut(screenshotWindow);
	};

	if (screenshotWindow.webContents.isLoadingMainFrame()) {
		screenshotWindow.webContents.once("did-finish-load", dispatch);
	} else {
		dispatch();
	}
}

function stopScreenshotRegionShortcutRegistration() {
	if (screenshotRegionShortcutRetry) clearInterval(screenshotRegionShortcutRetry);
	screenshotRegionShortcutRetry = null;
	if (screenshotRegionShortcutRegistered) {
		globalShortcut.unregister(SCREENSHOT_REGION_SHORTCUT);
		screenshotRegionShortcutRegistered = false;
	}
}

function attemptScreenshotRegionShortcutRegistration() {
	if (
		!screenshotRegionShortcutInitialized ||
		trayShowsRecording ||
		screenshotRegionShortcutRegistered
	) {
		return;
	}
	try {
		screenshotRegionShortcutRegistered = globalShortcut.register(
			SCREENSHOT_REGION_SHORTCUT,
			triggerScreenshotRegionShortcut,
		);
	} catch (error) {
		console.warn(`[screenshot] failed to register ${SCREENSHOT_REGION_SHORTCUT}`, error);
	}
	if (screenshotRegionShortcutRegistered) {
		if (screenshotRegionShortcutRetry) clearInterval(screenshotRegionShortcutRetry);
		screenshotRegionShortcutRetry = null;
		return;
	}
	if (!screenshotRegionShortcutWarned) {
		screenshotRegionShortcutWarned = true;
		console.warn(
			`[screenshot] ${SCREENSHOT_REGION_SHORTCUT} is currently used by another application; retrying`,
		);
	}
	if (!screenshotRegionShortcutRetry) {
		screenshotRegionShortcutRetry = setInterval(
			attemptScreenshotRegionShortcutRegistration,
			SCREENSHOT_REGION_SHORTCUT_RETRY_MS,
		);
		screenshotRegionShortcutRetry.unref?.();
	}
}

function registerScreenshotRegionShortcut() {
	// Keep Ctrl+R working inside OpenScreen even when another application owns
	// the system-wide registration. The global binding is retried below so it
	// becomes available automatically after that application releases it.
	app.on("web-contents-created", (_event, contents) => {
		contents.on("before-input-event", (event, input) => {
			const primaryModifier = process.platform === "darwin" ? input.meta : input.control;
			const extraPlatformModifier = process.platform === "darwin" ? input.control : input.meta;
			if (
				input.type !== "keyDown" ||
				input.isAutoRepeat ||
				trayShowsRecording ||
				!primaryModifier ||
				extraPlatformModifier ||
				input.alt ||
				input.shift ||
				input.key.toLowerCase() !== "r"
			) {
				return;
			}
			event.preventDefault();
			triggerScreenshotRegionShortcut();
		});
	});

	screenshotRegionShortcutInitialized = true;
	attemptScreenshotRegionShortcutRegistration();
	app.once("will-quit", () => {
		screenshotRegionShortcutInitialized = false;
		stopScreenshotRegionShortcutRegistration();
	});
}

if (isPrimaryInstance) {
	app.on("second-instance", (_event, argv) => {
		if (shouldStartInTray(argv, process.platform)) return;

		void (applicationInitialized ?? app.whenReady()).then(showMainWindow);
	});
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
	if (targetWindow?.webContents.getURL().includes("windowType=screenshot")) {
		targetWindow.webContents.send(channel);
		return;
	}

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{
					role: "about",
					label: mainT("common", "actions.about") || "About OpenScreen",
				},
				{ type: "separator" },
				{
					role: "services",
					label: mainT("common", "actions.services") || "Services",
				},
				{ type: "separator" },
				{
					role: "hide",
					label: mainT("common", "actions.hide") || "Hide OpenScreen",
				},
				{
					role: "hideOthers",
					label: mainT("common", "actions.hideOthers") || "Hide Others",
				},
				{
					role: "unhide",
					label: mainT("common", "actions.unhide") || "Show All",
				},
				{ type: "separator" },
				{
					label: mainT("common", "actions.quit") || "Quit",
					accelerator: "CmdOrCtrl+Q",
					click: requestApplicationQuit,
				},
			],
		});
	}

	template.push(
		{
			label: mainT("common", "actions.file") || "File",
			submenu: [
				{
					label: mainT("common", "actions.screenshot"),
					accelerator: "CmdOrCtrl+Shift+P",
					click: () => {
						createScreenshotWindow();
					},
				},
				{ type: "separator" },
				{
					label: mainT("dialogs", "unsavedChanges.loadProject") || "Load Project…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProject") || "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac
					? []
					: [
							{ type: "separator" as const },
							{
								label: mainT("common", "actions.quit") || "Quit",
								click: requestApplicationQuit,
							},
						]),
			],
		},
		{
			label: mainT("common", "actions.edit") || "Edit",
			submenu: [
				{ role: "undo", label: mainT("common", "actions.undo") || "Undo" },
				{ role: "redo", label: mainT("common", "actions.redo") || "Redo" },
				{ type: "separator" },
				{ role: "cut", label: mainT("common", "actions.cut") || "Cut" },
				{ role: "copy", label: mainT("common", "actions.copy") || "Copy" },
				{ role: "paste", label: mainT("common", "actions.paste") || "Paste" },
				{
					role: "selectAll",
					label: mainT("common", "actions.selectAll") || "Select All",
				},
			],
		},
		{
			label: mainT("common", "actions.view") || "View",
			submenu: [
				{
					role: "reload",
					label: mainT("common", "actions.reload") || "Reload",
					accelerator: "F5",
				},
				{
					role: "forceReload",
					label: mainT("common", "actions.forceReload") || "Force Reload",
				},
				{
					role: "toggleDevTools",
					label: mainT("common", "actions.toggleDevTools") || "Toggle Developer Tools",
				},
				{ type: "separator" },
				{
					role: "resetZoom",
					label: mainT("common", "actions.actualSize") || "Actual Size",
				},
				{
					role: "zoomIn",
					label: mainT("common", "actions.zoomIn") || "Zoom In",
				},
				{
					role: "zoomOut",
					label: mainT("common", "actions.zoomOut") || "Zoom Out",
				},
				{ type: "separator" },
				{
					role: "togglefullscreen",
					label: mainT("common", "actions.toggleFullScreen") || "Toggle Full Screen",
				},
			],
		},
		{
			label: mainT("common", "actions.window") || "Window",
			submenu: isMac
				? [
						{
							role: "minimize",
							label: mainT("common", "actions.minimize") || "Minimize",
						},
						{ role: "zoom" },
						{ type: "separator" },
						{ role: "front" },
					]
				: [
						{
							role: "minimize",
							label: mainT("common", "actions.minimize") || "Minimize",
						},
						{
							role: "close",
							label: mainT("common", "actions.close") || "Close",
						},
					],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
	tray.on("click", () => {
		showMainWindow();
	});
	tray.on("double-click", () => {
		showMainWindow();
	});
}

function getUpdateTrayMenuItem(): Electron.MenuItemConstructorOptions {
	const update = getUpdateStatus();
	const version = update.version || "";

	switch (update.phase) {
		case "checking":
			return {
				label: mainT("common", "actions.checkingForUpdates"),
				enabled: false,
			};
		case "available":
		case "downloading":
			return {
				label: mainT("common", "actions.downloadingUpdate", {
					percent: Math.round(update.percent ?? 0),
				}),
				enabled: false,
			};
		case "downloaded":
			return {
				label: mainT("common", "actions.restartToUpdate", { version }),
				click: () => {
					installDownloadedUpdate();
				},
			};
		case "not-available":
			return {
				label: mainT("common", "actions.upToDateCheckAgain"),
				click: () => {
					void checkForUpdates();
				},
			};
		case "error":
			return {
				label: mainT("common", "actions.updateFailedRetry"),
				click: () => {
					void checkForUpdates();
				},
			};
		default:
			return {
				label: mainT("common", "actions.checkForUpdates"),
				click: () => {
					void checkForUpdates();
				},
			};
	}
}

function getTrayIcon(filename: string, size: number) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: size,
			height: size,
			quality: "best",
		});
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording
		? mainT("common", "actions.recordingStatus", {
				source: selectedSourceName,
			}) || `Recording: ${selectedSourceName}`
		: "OpenScreen";
	const menuTemplate = recording
		? [
				{
					label: mainT("common", "actions.stopRecording") || "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: mainT("common", "actions.open") || "Open",
					click: () => {
						showMainWindow();
					},
				},
				getUpdateTrayMenuItem(),
				{ type: "separator" as const },
				{
					label: mainT("common", "actions.quit") || "Quit",
					click: requestApplicationQuit,
				},
			];
	trayShowsRecording = recording;
	if (screenshotRegionShortcutInitialized) {
		if (recording) stopScreenshotRegionShortcutRegistration();
		else attemptScreenshotRegionShortcutRegistration();
	}
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

/**
 * Takes the tray icon out of the notification area while a screenshot is
 * captured, so OpenScreen does not appear in its own full-screen capture, and
 * returns the call that puts it back. Electron's Tray has no hide(), so the
 * icon is destroyed and rebuilt with the state it was showing.
 */
function suppressTrayIcon(): () => void {
	if (!tray || tray.isDestroyed()) {
		return () => undefined;
	}
	const recording = trayShowsRecording;
	tray.destroy();
	tray = null;
	let restored = false;
	return () => {
		if (restored || tray) {
			return;
		}
		restored = true;
		try {
			createTray();
			updateTrayMenu(recording);
		} catch (error) {
			console.error("Failed to restore the tray icon after a screenshot:", error);
		}
	};
}

const dirtyWebContentsIds = new Set<number>();
const trackedDirtyWebContentsIds = new Set<number>();
let isForceClosing = false;
let isCloseConfirmInFlight = false;
let pendingExitAction: (() => void) | null = null;
let pendingExitClosesEditors = false;
let waitingForExitWindow: BrowserWindow | null = null;
let waitingForExitWindowClosed: (() => void) | null = null;

ipcMain.on("set-has-unsaved-changes", (event, hasChanges: unknown) => {
	if (typeof hasChanges !== "boolean") return;
	const owner = BrowserWindow.fromWebContents(event.sender);
	if (!owner || owner.isDestroyed()) return;

	const senderId = event.sender.id;
	if (hasChanges) {
		dirtyWebContentsIds.add(senderId);
		if (!trackedDirtyWebContentsIds.has(senderId)) {
			trackedDirtyWebContentsIds.add(senderId);
			event.sender.once("destroyed", () => {
				dirtyWebContentsIds.delete(senderId);
				trackedDirtyWebContentsIds.delete(senderId);
			});
		}
	} else {
		dirtyWebContentsIds.delete(senderId);
		if (
			waitingForExitWindow &&
			!waitingForExitWindow.isDestroyed() &&
			waitingForExitWindow.webContents.id === senderId
		) {
			clearWaitingForExitWindow();
			continuePendingExit();
		}
	}
});

ipcMain.on("cancel-pending-exit", (event) => {
	const owner = BrowserWindow.fromWebContents(event.sender);
	if (!owner || owner.isDestroyed()) return;
	cancelPendingExit(event.sender.id);
});

function isWindowDirty(window: BrowserWindow): boolean {
	return (
		!window.isDestroyed() &&
		!window.webContents.isDestroyed() &&
		dirtyWebContentsIds.has(window.webContents.id)
	);
}

function isEditorLikeWindow(window: BrowserWindow): boolean {
	if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
	const url = window.webContents.getURL();
	return url.includes("windowType=editor") || url.includes("windowType=screenshot");
}

function getNextExitBlockingWindow(): BrowserWindow | undefined {
	const windows = BrowserWindow.getAllWindows();
	if (pendingExitClosesEditors) {
		const editorWindow = windows.find((window) => isEditorLikeWindow(window));
		if (editorWindow) return editorWindow;
	}
	return windows.find((window) => isWindowDirty(window));
}

function clearWaitingForExitWindow() {
	if (waitingForExitWindow && waitingForExitWindowClosed && !waitingForExitWindow.isDestroyed()) {
		waitingForExitWindow.removeListener("closed", waitingForExitWindowClosed);
	}
	waitingForExitWindow = null;
	waitingForExitWindowClosed = null;
}

function cancelPendingExit(senderId?: number) {
	if (
		senderId !== undefined &&
		waitingForExitWindow &&
		!waitingForExitWindow.isDestroyed() &&
		waitingForExitWindow.webContents.id !== senderId
	) {
		return;
	}
	pendingExitAction = null;
	pendingExitClosesEditors = false;
	clearWaitingForExitWindow();
}

function continuePendingExit() {
	if (!pendingExitAction) return;
	if (
		waitingForExitWindow &&
		(waitingForExitWindow.isDestroyed() || waitingForExitWindow.webContents.isDestroyed())
	) {
		return;
	}

	const blockingWindow = getNextExitBlockingWindow();
	if (!blockingWindow) {
		const action = pendingExitAction;
		pendingExitAction = null;
		pendingExitClosesEditors = false;
		clearWaitingForExitWindow();
		action();
		return;
	}

	if (waitingForExitWindow === blockingWindow) {
		blockingWindow.close();
		return;
	}

	clearWaitingForExitWindow();
	const senderId = blockingWindow.webContents.id;
	const handleClosed = () => {
		dirtyWebContentsIds.delete(senderId);
		if (waitingForExitWindow !== blockingWindow) return;
		waitingForExitWindow = null;
		waitingForExitWindowClosed = null;
		continuePendingExit();
	};
	waitingForExitWindow = blockingWindow;
	waitingForExitWindowClosed = handleClosed;
	blockingWindow.once("closed", handleClosed);
	blockingWindow.close();
}

function requestExitAction(action: () => void, closeEditorsBeforeAction = false) {
	pendingExitAction = action;
	pendingExitClosesEditors = closeEditorsBeforeAction;
	continuePendingExit();
}

function requestApplicationQuit() {
	requestExitAction(() => app.quit(), true);
}

function waitForWindowIpcResponse<T>(
	window: BrowserWindow,
	channel: string,
	onResponse: (payload: T) => void,
	onWindowClosed: () => void = () => undefined,
	options?: { timeoutMs: number; onTimeout: () => void },
) {
	const senderId = window.webContents.id;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const cleanup = () => {
		if (timeout) clearTimeout(timeout);
		ipcMain.removeListener(channel, listener);
		window.removeListener("closed", handleWindowClosed);
	};
	const handleWindowClosed = () => {
		cleanup();
		onWindowClosed();
	};
	const listener = (event: Electron.IpcMainEvent, payload: T) => {
		if (event.sender.id !== senderId) return;
		cleanup();
		onResponse(payload);
	};

	ipcMain.on(channel, listener);
	window.once("closed", handleWindowClosed);
	if (options) {
		timeout = setTimeout(() => {
			cleanup();
			options.onTimeout();
		}, options.timeoutMs);
	}
	return cleanup;
}

function forceCloseEditorWindow(windowToClose: BrowserWindow | null, onClosed?: () => void) {
	if (!windowToClose || windowToClose.isDestroyed()) return;

	isForceClosing = true;
	setImmediate(() => {
		if (windowToClose.isDestroyed()) {
			isForceClosing = false;
			onClosed?.();
			return;
		}
		windowToClose.once("closed", () => {
			isForceClosing = false;
			onClosed?.();
		});
		windowToClose.close();
	});
}

app.on("before-quit", (event) => {
	const windows = BrowserWindow.getAllWindows();
	if (!windows.some((window) => isEditorLikeWindow(window) || isWindowDirty(window))) return;

	event.preventDefault();
	if (!pendingExitAction) {
		pendingExitAction = () => app.quit();
		pendingExitClosesEditors = true;
	}
	continuePendingExit();
});

function prepareUpdateInstall(install: () => void) {
	requestExitAction(install, true);
}

function createEditorWindowWrapper() {
	if (mainWindow) {
		cancelPendingExit();
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	const editorWindow = createEditorWindow();
	mainWindow = editorWindow;
	let forceClosePromptOpen = false;
	let cancelEditorWait: (() => void) | null = null;

	function cancelEditorClose(windowToClose: BrowserWindow) {
		isCloseConfirmInFlight = false;
		cancelPendingExit(windowToClose.webContents.id);
	}

	function finishEditorClose(windowToClose: BrowserWindow) {
		isCloseConfirmInFlight = false;
		forceCloseEditorWindow(windowToClose);
	}

	async function offerForceClose(windowToClose: BrowserWindow) {
		if (forceClosePromptOpen || windowToClose.isDestroyed()) return;
		forceClosePromptOpen = true;
		cancelEditorWait?.();
		cancelEditorWait = null;
		if (!windowToClose.webContents.isDestroyed()) {
			windowToClose.webContents.send("cancel-close-confirm");
		}
		try {
			const result = await dialog.showMessageBox(windowToClose, {
				type: "warning",
				title: mainT("dialogs", "unsavedChanges.editorNotResponding"),
				message: mainT("dialogs", "unsavedChanges.editorNotResponding"),
				detail: mainT("dialogs", "unsavedChanges.forceCloseDetail"),
				buttons: [
					mainT("common", "actions.cancel"),
					mainT("dialogs", "unsavedChanges.discardAndClose"),
				],
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});

			if (windowToClose.isDestroyed()) {
				isCloseConfirmInFlight = false;
				return;
			}
			if (result.response === 1) {
				finishEditorClose(windowToClose);
			} else {
				cancelEditorClose(windowToClose);
			}
		} catch (error) {
			console.error("Failed to show the editor recovery dialog:", error);
			if (!windowToClose.isDestroyed()) cancelEditorClose(windowToClose);
		} finally {
			forceClosePromptOpen = false;
		}
	}

	function requestEditorCloseState(windowToClose: BrowserWindow) {
		if (windowToClose.isDestroyed()) {
			isCloseConfirmInFlight = false;
			cancelPendingExit();
			return;
		}

		cancelEditorWait?.();
		windowToClose.webContents.send("request-close-state");
		cancelEditorWait = waitForWindowIpcResponse<boolean>(
			windowToClose,
			"close-state-response",
			(hasChanges) => {
				cancelEditorWait = null;
				if (forceClosePromptOpen || !isCloseConfirmInFlight) return;
				if (windowToClose.isDestroyed()) {
					isCloseConfirmInFlight = false;
					cancelPendingExit();
					return;
				}

				if (hasChanges === false) {
					finishEditorClose(windowToClose);
					return;
				}

				requestEditorCloseConfirmation(windowToClose);
			},
			() => {
				cancelEditorWait = null;
				isCloseConfirmInFlight = false;
			},
			{
				timeoutMs: 2_000,
				onTimeout: () => {
					cancelEditorWait = null;
					void offerForceClose(windowToClose);
				},
			},
		);
	}

	function requestEditorCloseConfirmation(windowToClose: BrowserWindow) {
		if (windowToClose.isDestroyed()) {
			isCloseConfirmInFlight = false;
			cancelPendingExit();
			return;
		}

		cancelEditorWait?.();
		windowToClose.webContents.send("request-close-confirm");
		cancelEditorWait = waitForWindowIpcResponse<"save" | "discard" | "cancel">(
			windowToClose,
			"close-confirm-response",
			(choice) => {
				cancelEditorWait = null;
				if (forceClosePromptOpen || !isCloseConfirmInFlight) return;
				if (windowToClose.isDestroyed()) {
					isCloseConfirmInFlight = false;
					cancelPendingExit();
					return;
				}

				if (choice === "save") {
					windowToClose.webContents.send("request-save-before-close");
					cancelEditorWait = waitForWindowIpcResponse<boolean>(
						windowToClose,
						"save-before-close-done",
						(shouldClose) => {
							cancelEditorWait = null;
							if (forceClosePromptOpen || !isCloseConfirmInFlight) return;
							if (!shouldClose) {
								cancelEditorClose(windowToClose);
								return;
							}
							// Saving can take long enough for the project to change again.
							// Re-check before closing instead of assuming the saved snapshot is current.
							requestEditorCloseState(windowToClose);
						},
						() => {
							cancelEditorWait = null;
							isCloseConfirmInFlight = false;
						},
					);
				} else if (choice === "discard") {
					finishEditorClose(windowToClose);
				} else {
					cancelEditorClose(windowToClose);
				}
			},
			() => {
				cancelEditorWait = null;
				isCloseConfirmInFlight = false;
			},
		);
	}

	editorWindow.on("close", (event) => {
		if (isForceClosing) return;

		event.preventDefault();
		if (isCloseConfirmInFlight) return;
		isCloseConfirmInFlight = true;

		const windowToClose = editorWindow;
		if (windowToClose.isDestroyed()) {
			isCloseConfirmInFlight = false;
			return;
		}
		requestEditorCloseState(windowToClose);
	});

	editorWindow.on("unresponsive", () => {
		if (isCloseConfirmInFlight) void offerForceClose(editorWindow);
	});
	editorWindow.webContents.on("render-process-gone", () => {
		if (isCloseConfirmInFlight) void offerForceClose(editorWindow);
	});
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

function createCountdownOverlayWindowWrapper() {
	if (countdownOverlayWindow && !countdownOverlayWindow.isDestroyed()) {
		return countdownOverlayWindow;
	}

	countdownOverlayWindow = createCountdownOverlayWindow();
	countdownOverlayWindow.on("closed", () => {
		countdownOverlayWindow = null;
	});
	return countdownOverlayWindow;
}

// Keep the main process alive after the last window closes. The tray's Quit
// action remains the explicit way to stop OpenScreen.
app.on("window-all-closed", () => undefined);

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	const hasVisibleWindow = BrowserWindow.getAllWindows().some((window) => {
		if (window.isDestroyed() || !window.isVisible()) {
			return false;
		}

		const url = window.webContents.getURL();
		const isCountdownOverlayWindow = url.includes("windowType=countdown-overlay");
		return !isCountdownOverlayWindow;
	});
	if (!hasVisibleWindow) {
		void (applicationInitialized ?? app.whenReady()).then(showMainWindow);
	}
});

async function initializeApplication() {
	await app.whenReady();
	// Force the app into "regular" activation policy so the Dock icon appears.
	// The HUD overlay (transparent + frameless + skipTaskbar) is the first
	// window we open, and AppKit otherwise classifies us as an accessory app.
	if (process.platform === "darwin") {
		app.dock?.show();
	}

	// Allow microphone/media/screen permission checks
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = [
			"media",
			"audioCapture",
			"microphone",
			"videoCapture",
			"camera",
			"screen",
			"display-capture",
		];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = [
			"media",
			"audioCapture",
			"microphone",
			"videoCapture",
			"camera",
			"screen",
			"display-capture",
		];
		callback(allowed.includes(permission));
	});

	session.defaultSession.setDisplayMediaRequestHandler(
		(request, callback) => {
			const source = getSelectedDesktopSource();
			if (!request.videoRequested || !source) {
				callback({});
				return;
			}

			callback({
				video: source,
				...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" } : {}),
			});
		},
		{ useSystemPicker: false },
	);

	// Request microphone permission from macOS. Screen Recording is requested
	// lazily from the source-picker action so the system prompt is not hidden
	// behind OpenScreen's source selector window.
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	// Closing the HUD keeps OpenScreen available from the tray.
	ipcMain.on("hud-overlay-close", () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.hide();
		}
	});
	ipcMain.handle("set-locale", (_, locale: string) => {
		setMainLocale(locale);
		setupApplicationMenu();
		updateTrayMenu(trayShowsRecording);
	});

	// Ensure recordings directory exists
	await ensureRecordingsDir();
	function switchToHudWrapper() {
		if (mainWindow) {
			cancelPendingExit();
			isForceClosing = true;
			mainWindow.close();
			isForceClosing = false;
			mainWindow = null;
		}
		showMainWindow();
	}

	startMcpControlServer({
		getMainWindow: () => mainWindow,
		ensureWindow: (action) => {
			if (action === "list_sources" || action === "record_video") {
				switchToHudWrapper();
				return;
			}
			showMainWindow();
		},
	});

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		createCountdownOverlayWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		() => countdownOverlayWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				showMainWindow();
			}
		},
		switchToHudWrapper,
		suppressTrayIcon,
	);

	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	registerScreenshotRegionShortcut();
	try {
		ensureWindowsAutoStart(app, process.platform, process.execPath);
	} catch (error) {
		console.error("Failed to configure Windows startup:", error);
	}
	const unsubscribeFromUpdateStatus = onUpdateStatusChanged((update) => {
		updateTrayMenu(trayShowsRecording);
		if (update.phase !== "downloaded" || !Notification.isSupported()) {
			return;
		}
		new Notification({
			title: "OpenScreen",
			body: mainT("common", "actions.restartToUpdate", {
				version: update.version || app.getVersion(),
			}),
		}).show();
	});
	app.once("will-quit", unsubscribeFromUpdateStatus);
	setUpdateInstallHandler(prepareUpdateInstall);
	app.once("will-quit", () => setUpdateInstallHandler(null));
	initializeAutoUpdates();
	if (!startsInTray) {
		showMainWindow();
	}
	// Ctrl+R is global, so keep its renderer/controller ready even when the
	// screenshot workspace has not been opened yet. The prewarmed window stays
	// hidden and HEADLESS runs opt out inside prewarmScreenshotWindow().
	prewarmScreenshotWindow();
}

if (isPrimaryInstance) {
	applicationInitialized = initializeApplication();
}
