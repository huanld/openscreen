import type { App, LoginItemSettings } from "electron";
import { describe, expect, it, vi } from "vitest";
import { ensureWindowsAutoStart, START_IN_TRAY_ARG, shouldStartInTray } from "./windowsStartup";

function createApp(options: { isPackaged?: boolean; openAtLogin?: boolean } = {}) {
	const setLoginItemSettings = vi.fn();
	const app = {
		isPackaged: options.isPackaged ?? true,
		getLoginItemSettings: vi.fn(
			() => ({ openAtLogin: options.openAtLogin ?? false }) as LoginItemSettings,
		),
		setLoginItemSettings,
	} as unknown as Pick<App, "getLoginItemSettings" | "isPackaged" | "setLoginItemSettings">;
	return { app, setLoginItemSettings };
}

describe("Windows startup", () => {
	it("recognizes a Windows login launch as tray-only", () => {
		expect(shouldStartInTray(["Openscreen.exe", START_IN_TRAY_ARG], "win32")).toBe(true);
		expect(shouldStartInTray(["Openscreen.exe", START_IN_TRAY_ARG], "darwin")).toBe(false);
	});

	it("registers packaged Windows builds to start in the tray", () => {
		const { app, setLoginItemSettings } = createApp();

		expect(
			ensureWindowsAutoStart(app, "win32", "C:\\Program Files\\OpenScreen\\Openscreen.exe"),
		).toBe(true);
		expect(setLoginItemSettings).toHaveBeenCalledWith({
			openAtLogin: true,
			enabled: true,
			name: "OpenScreen",
			path: "C:\\Program Files\\OpenScreen\\Openscreen.exe",
			args: [START_IN_TRAY_ARG],
		});
	});

	it("preserves an existing login registration", () => {
		const { app, setLoginItemSettings } = createApp({ openAtLogin: true });

		expect(ensureWindowsAutoStart(app, "win32", "Openscreen.exe")).toBe(false);
		expect(setLoginItemSettings).not.toHaveBeenCalled();
	});

	it("does not register development or non-Windows builds", () => {
		const unpackaged = createApp({ isPackaged: false });
		const mac = createApp();

		expect(ensureWindowsAutoStart(unpackaged.app, "win32", "electron.exe")).toBe(false);
		expect(ensureWindowsAutoStart(mac.app, "darwin", "Openscreen")).toBe(false);
		expect(unpackaged.setLoginItemSettings).not.toHaveBeenCalled();
		expect(mac.setLoginItemSettings).not.toHaveBeenCalled();
	});
});
