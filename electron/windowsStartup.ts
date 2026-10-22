import type { App } from "electron";

export const START_IN_TRAY_ARG = "--start-in-tray";

type LoginItemApp = Pick<App, "getLoginItemSettings" | "isPackaged" | "setLoginItemSettings">;

export function shouldStartInTray(argv: readonly string[], platform: NodeJS.Platform): boolean {
	return platform === "win32" && argv.includes(START_IN_TRAY_ARG);
}

export function ensureWindowsAutoStart(
	app: LoginItemApp,
	platform: NodeJS.Platform,
	executablePath: string,
): boolean {
	if (platform !== "win32" || !app.isPackaged) {
		return false;
	}

	const args = [START_IN_TRAY_ARG];
	const current = app.getLoginItemSettings({ path: executablePath, args });
	if (current.openAtLogin) {
		return false;
	}

	app.setLoginItemSettings({
		openAtLogin: true,
		enabled: true,
		name: "OpenScreen",
		path: executablePath,
		args,
	});
	return true;
}
