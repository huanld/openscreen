import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<Listener>>();
	const autoUpdater = {
		allowDowngrade: true,
		autoDownload: false,
		autoInstallOnAppQuit: false,
		disableWebInstaller: false,
		logger: null as unknown,
		requestHeaders: undefined as Record<string, string> | undefined,
		checkForUpdates: vi.fn(async () => null),
		quitAndInstall: vi.fn(),
		setFeedURL: vi.fn(),
		on: vi.fn((event: string, listener: Listener) => {
			const eventListeners = listeners.get(event) ?? new Set<Listener>();
			eventListeners.add(listener);
			listeners.set(event, eventListeners);
			return autoUpdater;
		}),
	};

	return {
		autoUpdater,
		getAllWindows: vi.fn(() => []),
		handle: vi.fn(),
		emit(event: string, ...args: unknown[]) {
			for (const listener of listeners.get(event) ?? []) listener(...args);
		},
		resetListeners() {
			listeners.clear();
		},
	};
});

vi.mock("electron", () => ({
	app: {
		getVersion: () => "1.4.15",
		isPackaged: true,
	},
	BrowserWindow: { getAllWindows: mocks.getAllWindows },
	ipcMain: { handle: mocks.handle },
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));

const updateInfo = {
	version: "1.4.16",
	releaseName: "OpenScreen 1.4.16",
	releaseNotes: "Tray update",
};

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocks.resetListeners();
	mocks.autoUpdater.allowDowngrade = true;
	mocks.autoUpdater.autoDownload = false;
	mocks.autoUpdater.autoInstallOnAppQuit = false;
	mocks.autoUpdater.disableWebInstaller = false;
	mocks.autoUpdater.requestHeaders = undefined;
	mocks.autoUpdater.checkForUpdates.mockResolvedValue(null);
	delete process.env.OPENSCREEN_UPDATE_FEED_URL;
	delete process.env.OPENSCREEN_UPDATE_TOKEN;
});

describe("auto updater", () => {
	it("configures automatic downloads without allowing downgrade or web installers", async () => {
		const { initializeAutoUpdates } = await import("./updater");

		initializeAutoUpdates();

		expect(mocks.autoUpdater.autoDownload).toBe(true);
		expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true);
		expect(mocks.autoUpdater.allowDowngrade).toBe(false);
		expect(mocks.autoUpdater.disableWebInstaller).toBe(true);
		expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
			provider: "generic",
			url: "https://gittea.softs.business/huanld/openscreen/raw/branch/release-assets%2Flatest",
		});
	});

	it("deduplicates manual checks and exposes the resulting status", async () => {
		let resolveCheck: (() => void) | undefined;
		mocks.autoUpdater.checkForUpdates.mockImplementation(
			() => new Promise((resolve) => (resolveCheck = () => resolve(null))),
		);
		const { checkForUpdates, getUpdateStatus, initializeAutoUpdates } = await import("./updater");
		initializeAutoUpdates();

		const first = checkForUpdates();
		const second = checkForUpdates();
		mocks.emit("update-not-available", updateInfo);
		resolveCheck?.();
		await Promise.all([first, second]);

		expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
		expect(getUpdateStatus()).toMatchObject({
			phase: "not-available",
			currentVersion: "1.4.15",
			version: "1.4.16",
		});
	});

	it("publishes downloaded status and restarts through the updater", async () => {
		const { initializeAutoUpdates, installDownloadedUpdate, onUpdateStatusChanged } = await import(
			"./updater"
		);
		initializeAutoUpdates();
		const listener = vi.fn();
		onUpdateStatusChanged(listener);

		mocks.emit("update-downloaded", updateInfo);
		const result = installDownloadedUpdate();
		await vi.advanceTimersByTimeAsync(0);

		expect(listener).toHaveBeenLastCalledWith(
			expect.objectContaining({ phase: "downloaded", version: "1.4.16" }),
		);
		expect(result.success).toBe(true);
		expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
	});

	it("lets the app defer installation until unsaved work is handled", async () => {
		const { initializeAutoUpdates, installDownloadedUpdate, setUpdateInstallHandler } =
			await import("./updater");
		initializeAutoUpdates();
		mocks.emit("update-downloaded", updateInfo);
		let install: (() => void) | undefined;
		setUpdateInstallHandler((ready) => {
			install = ready;
		});

		expect(installDownloadedUpdate().success).toBe(true);
		expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
		install?.();
		await vi.advanceTimersByTimeAsync(0);

		expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
	});

	it("refuses installation before an update is downloaded", async () => {
		const { initializeAutoUpdates, installDownloadedUpdate } = await import("./updater");
		initializeAutoUpdates();

		expect(installDownloadedUpdate()).toMatchObject({
			success: false,
			error: "No downloaded update is ready to install.",
		});
		expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});
});
