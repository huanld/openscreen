import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron, expect, test } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 800;

type RegionSession = {
	app: ElectronApplication;
	workspace: Page;
	workspaceId: number;
	directory: string;
	fixtureDataUrl: string;
};

async function withRegionSession(run: (session: RegionSession) => Promise<void>) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openscreen-region-e2e-"));
	const app = await electron.launch({
		args: [
			path.join(ROOT, "dist-electron/main.js"),
			"--no-sandbox",
			"--enable-unsafe-swiftshader",
			"--lang=en-US",
			`--user-data-dir=${path.join(directory, "profile")}`,
		],
		env: { ...process.env, HEADLESS: "true", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
	});
	const child = app.process();
	try {
		const launch = await app.firstWindow({ timeout: 60_000 });
		await launch.waitForLoadState("domcontentloaded");
		const languagePrompt = launch.getByRole("button", {
			name: /Keep current language|Giữ ngôn ngữ hiện tại|Conserver la langue actuelle/i,
		});
		if (await languagePrompt.count()) await languagePrompt.click();
		const fixtureDataUrl = await launch.evaluate(
			({ width, height }) => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas is unavailable.");
				for (const [color, x, y] of [
					["#e83b46", 0, 0],
					["#35b574", width / 2, 0],
					["#326bdf", 0, height / 2],
					["#edbb38", width / 2, height / 2],
				] as const) {
					context.fillStyle = color;
					context.fillRect(x, y, width / 2, height / 2);
				}
				return canvas.toDataURL("image/png");
			},
			{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
		);
		await app.evaluate(
			({ desktopCapturer, nativeImage, screen }, payload) => {
				const thumbnail = nativeImage.createFromDataURL(payload.dataUrl);
				const primary = screen.getPrimaryDisplay();
				const display = {
					...primary,
					size: { width: payload.width, height: payload.height },
					scaleFactor: 1,
				};
				screen.getAllDisplays = () => [display];
				screen.getDisplayNearestPoint = () => display;
				desktopCapturer.getSources = async (options) =>
					options.types.includes("screen")
						? [
								{
									id: "screen:0:0",
									name: "Region fixture display",
									display_id: String(display.id),
									thumbnail,
									appIcon: null,
								},
							]
						: [];
			},
			{ dataUrl: fixtureDataUrl, width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
		);
		const screenshotOpened = app.waitForEvent("window", {
			predicate: (page) => new URL(page.url()).searchParams.get("windowType") === "screenshot",
			timeout: 15_000,
		});
		await launch.getByTestId("launch-screenshot-button").click();
		const workspace = await screenshotOpened;
		// Electron resolves beforeunload itself; do not auto-dismiss a stale CDP dialog.
		workspace.on("dialog", (dialog) => {
			if (dialog.type() !== "beforeunload") void dialog.dismiss();
		});
		await expect(workspace.getByTestId("screenshot-workspace")).toBeVisible();
		const workspaceId = await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows().find(
				(candidate) =>
					new URL(candidate.webContents.getURL()).searchParams.get("windowType") === "screenshot",
			);
			if (!window) throw new Error("Screenshot workspace is unavailable.");
			// Make this isolated test window visible so restoration tests use the real OS window state.
			window.showInactive();
			return window.id;
		});
		await run({ app, workspace, workspaceId, directory, fixtureDataUrl });
	} finally {
		await Promise.race([
			app.close().catch(() => undefined),
			new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
		]);
		if (child.exitCode === null && child.signalCode === null) {
			child.kill();
			await Promise.race([
				once(child, "close"),
				new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
			]);
		}
		const resolved = path.resolve(directory);
		if (
			path.dirname(resolved) === path.resolve(os.tmpdir()) &&
			path.basename(resolved).startsWith("openscreen-region-e2e-")
		) {
			try {
				fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
			} catch (error) {
				console.warn(`Could not clean up Electron test profile ${resolved}:`, error);
			}
		}
	}
}

function workspaceVisible(session: RegionSession) {
	return session.app.evaluate(
		({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible() ?? false,
		session.workspaceId,
	);
}

async function openRegion(session: RegionSession, selectSource = true, viaShortcut = false) {
	if (selectSource) {
		await session.workspace
			.getByTestId("screenshot-source")
			.filter({ hasText: "Region fixture display" })
			.click();
	}
	const opened = session.app.waitForEvent("window", {
		predicate: (page) => new URL(page.url()).searchParams.get("windowType") === "screenshot-region",
		timeout: 15_000,
	});
	if (viaShortcut) {
		await session.app.evaluate(({ BrowserWindow }, platform) => {
			const screenshot = BrowserWindow.getAllWindows().find((window) =>
				window.webContents.getURL().includes("windowType=screenshot"),
			);
			if (!screenshot) throw new Error("Screenshot workspace is unavailable.");
			const modifiers = [platform === "darwin" ? "meta" : "control"] as const;
			screenshot.webContents.sendInputEvent({ type: "keyDown", keyCode: "R", modifiers });
			screenshot.webContents.sendInputEvent({ type: "keyUp", keyCode: "R", modifiers });
		}, process.platform);
	} else {
		await session.workspace.getByTestId("screenshot-capture-region").click();
	}
	let overlay: Page;
	try {
		overlay = await opened;
	} catch (error) {
		const visibleErrors = await session.workspace.locator('[role="alert"]').allTextContents();
		throw new Error(`${String(error)} Workspace errors: ${visibleErrors.join(" | ")}`);
	}
	await expect(overlay.getByTestId("screenshot-region-overlay")).toHaveAttribute(
		"aria-busy",
		"false",
	);
	await expect
		.poll(() =>
			overlay.getByTestId("screenshot-region-instructions").evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					background: style.backgroundColor,
					border: style.borderColor,
					shadow: style.boxShadow,
				};
			}),
		)
		.toEqual({ background: "rgba(0, 0, 0, 0)", border: "rgba(0, 0, 0, 0)", shadow: "none" });
	await expect
		.poll(() =>
			overlay.getByTestId("screenshot-region-cancel").evaluate((element) => {
				const style = getComputedStyle(element);
				return { background: style.backgroundColor, border: style.borderColor };
			}),
		)
		.toEqual({ background: "rgba(0, 0, 0, 0)", border: "rgba(0, 0, 0, 0)" });
	const overlayBounds = await session.app.evaluate(({ BrowserWindow, screen }) => {
		const regionWindow = BrowserWindow.getAllWindows().find(
			(window) =>
				new URL(window.webContents.getURL()).searchParams.get("windowType") === "screenshot-region",
		);
		return {
			actual: regionWindow?.getContentBounds(),
			expected: screen.getPrimaryDisplay().bounds,
		};
	});
	expect(overlayBounds.actual).toEqual(overlayBounds.expected);
	await expect.poll(() => workspaceVisible(session)).toBe(false);
	return overlay;
}

test("region drag and reverse drag export the exact selected pixels", async () => {
	await withRegionSession(async (session) => {
		for (const reverse of [false, true]) {
			const overlay = await openRegion(session, reverse, !reverse);
			const bounds = await overlay.getByTestId("screenshot-region-overlay").boundingBox();
			if (!bounds) throw new Error("Region overlay has no bounds.");
			const left = Math.round(bounds.width / 4);
			const top = Math.round(bounds.height / 4);
			const right = Math.round((bounds.width * 3) / 4);
			const bottom = Math.round((bounds.height * 3) / 4);
			const start = reverse ? [right, bottom] : [left, top];
			const end = reverse ? [left, top] : [right, bottom];
			await overlay.mouse.move(bounds.x + start[0], bounds.y + start[1]);
			await overlay.mouse.down();
			await overlay.mouse.move(bounds.x + end[0], bounds.y + end[1], { steps: 5 });
			await expect(overlay.getByTestId("screenshot-region-selection")).toBeVisible();
			if (!reverse) {
				fs.mkdirSync(path.join(ROOT, ".codex-run"), { recursive: true });
				await overlay.screenshot({
					path: path.join(ROOT, ".codex-run/screenshot-region-preview.png"),
				});
			}
			const closed = overlay.waitForEvent("close");
			await overlay.mouse.up();
			await closed;
			await expect(session.workspace.getByTestId("screenshot-canvas")).toBeVisible();
			await expect.poll(() => workspaceVisible(session)).toBe(true);

			const filePath = path.join(session.directory, reverse ? "reverse.png" : "forward.png");
			await session.app.evaluate(({ dialog }, destination) => {
				dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
			}, filePath);
			await session.workspace.getByTestId("screenshot-save").click();
			await expect.poll(() => fs.existsSync(filePath)).toBe(true);
			const crop = {
				x: Math.floor((left / bounds.width) * IMAGE_WIDTH),
				y: Math.floor((top / bounds.height) * IMAGE_HEIGHT),
				width:
					Math.ceil((right / bounds.width) * IMAGE_WIDTH) -
					Math.floor((left / bounds.width) * IMAGE_WIDTH),
				height:
					Math.ceil((bottom / bounds.height) * IMAGE_HEIGHT) -
					Math.floor((top / bounds.height) * IMAGE_HEIGHT),
			};
			const result = await session.app.evaluate(
				({ nativeImage }, payload) => {
					const exported = nativeImage.createFromPath(payload.filePath);
					const expected = nativeImage.createFromDataURL(payload.dataUrl).crop(payload.crop);
					return {
						...exported.getSize(),
						pixelsMatch: exported.toBitmap().equals(expected.toBitmap()),
					};
				},
				{ filePath, dataUrl: session.fixtureDataUrl, crop },
			);
			expect(result).toEqual({ width: crop.width, height: crop.height, pixelsMatch: true });
			await expect(session.workspace.getByTestId("screenshot-save")).toBeEnabled();
			await session.workspace.getByRole("button", { name: /New capture|Chụp mới/i }).click();
			await expect(session.workspace.getByTestId("screenshot-workspace")).toBeVisible();
		}
	});
});

test("tiny selections do not capture and Escape restores the workspace for another attempt", async () => {
	await withRegionSession(async (session) => {
		const overlay = await openRegion(session);
		const bounds = await overlay.getByTestId("screenshot-region-overlay").boundingBox();
		if (!bounds) throw new Error("Region overlay has no bounds.");
		const center = {
			x: bounds.x + Math.floor(bounds.width / 2),
			y: bounds.y + Math.floor(bounds.height / 2),
		};
		await overlay.mouse.click(center.x, center.y);
		await expect(overlay.getByTestId("screenshot-region-overlay")).toBeVisible();
		await expect(overlay.getByTestId("screenshot-region-selection")).toHaveCount(0);
		await overlay.mouse.move(center.x, center.y);
		await overlay.mouse.down();
		await overlay.mouse.move(center.x + 1, center.y + 1);
		await overlay.mouse.up();
		await expect(overlay.getByTestId("screenshot-region-selection")).toHaveCount(0);
		await expect(session.workspace.getByTestId("screenshot-canvas")).toHaveCount(0);
		const closed = overlay.waitForEvent("close");
		await overlay.keyboard.press("Escape").catch((error: unknown) => {
			if (!/Target page, context or browser has been closed/.test(String(error))) throw error;
		});
		await closed;
		await expect(session.workspace.getByTestId("screenshot-capture-region")).toBeEnabled();
		await expect.poll(() => workspaceVisible(session)).toBe(true);

		const nextOverlay = await openRegion(session);
		const nextClosed = nextOverlay.waitForEvent("close");
		await nextOverlay.getByTestId("screenshot-region-cancel").click();
		await nextClosed;
		await expect(session.workspace.getByTestId("screenshot-workspace")).toBeVisible();
		await expect.poll(() => workspaceVisible(session)).toBe(true);
	});
});

test("Ctrl+R opens one coordinated overlay for every connected display", async () => {
	await withRegionSession(async (session) => {
		const expectedBounds = await session.app.evaluate(
			({ desktopCapturer, nativeImage, screen }, dataUrl) => {
				const thumbnail = nativeImage.createFromDataURL(dataUrl);
				const primary = screen.getPrimaryDisplay();
				const secondaryBounds = {
					x: primary.bounds.x - primary.bounds.width,
					y: primary.bounds.y - Math.round(primary.bounds.height / 3),
					width: primary.bounds.width,
					height: primary.bounds.height,
				};
				const secondary = {
					...primary,
					id: primary.id + 1000,
					bounds: secondaryBounds,
					workArea: secondaryBounds,
				};
				screen.getAllDisplays = () => [secondary, primary];
				desktopCapturer.getSources = async (options) =>
					options.types.includes("screen")
						? [
								{
									id: "screen:1:0",
									name: "Primary fixture display",
									display_id: String(primary.id),
									thumbnail,
									appIcon: null,
								},
								{
									id: "screen:0:0",
									name: "Secondary fixture display",
									display_id: String(secondary.id),
									thumbnail,
									appIcon: null,
								},
							]
						: [];
				return [secondaryBounds, primary.bounds];
			},
			session.fixtureDataUrl,
		);

		await session.app.evaluate(({ BrowserWindow }) => {
			const screenshot = BrowserWindow.getAllWindows().find(
				(window) =>
					new URL(window.webContents.getURL()).searchParams.get("windowType") === "screenshot",
			);
			if (!screenshot) throw new Error("Screenshot workspace is unavailable.");
			screenshot.webContents.send("screenshot:capture-region-shortcut");
		});
		await expect
			.poll(() =>
				session.app.evaluate(
					({ BrowserWindow }) =>
						BrowserWindow.getAllWindows().filter((window) =>
							window.webContents.getURL().includes("windowType=screenshot-region"),
						).length,
				),
			)
			.toBe(2);
		await expect
			.poll(
				() =>
					session.app
						.windows()
						.filter(
							(page) => new URL(page.url()).searchParams.get("windowType") === "screenshot-region",
						).length,
			)
			.toBe(2);
		const overlays = session.app
			.windows()
			.filter((page) => new URL(page.url()).searchParams.get("windowType") === "screenshot-region");
		expect(overlays).toHaveLength(2);
		await Promise.all(
			overlays.map((overlay) =>
				expect(overlay.getByTestId("screenshot-region-overlay")).toHaveAttribute(
					"aria-busy",
					"false",
				),
			),
		);
		const actualBounds = await session.app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()
				.filter((window) => window.webContents.getURL().includes("windowType=screenshot-region"))
				.map((window) => window.getBounds())
				.sort((left, right) => left.x - right.x || left.y - right.y),
		);
		expect(actualBounds).toEqual(
			[...expectedBounds].sort((left, right) => left.x - right.x || left.y - right.y),
		);

		const closed = overlays.map((overlay) => overlay.waitForEvent("close"));
		await overlays[0].getByTestId("screenshot-region-cancel").click();
		await Promise.all(closed);
		await expect.poll(() => workspaceVisible(session)).toBe(true);
	});
});
