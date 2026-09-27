import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron, expect, test } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WIDTH = 1600;
const HEIGHT = 900;

async function saveImage(app: ElectronApplication, page: Page, filePath: string, format = "png") {
	await app.evaluate(({ dialog }, destination) => {
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
	}, filePath);
	await page.getByTestId("screenshot-format").selectOption(format);
	await page.getByTestId("screenshot-save").click();
	await expect.poll(() => fs.existsSync(filePath)).toBe(true);
	await expect(page.getByTestId("screenshot-save")).toBeEnabled();
}

async function compareImages(app: ElectronApplication, actual: string, reference: string) {
	return app.evaluate(
		({ nativeImage }, paths) => {
			const image = nativeImage.createFromPath(paths.actual);
			const original = nativeImage.createFromPath(paths.reference);
			const bitmap = image.toBitmap();
			const originalBitmap = original.toBitmap();
			let changedPixels = 0;
			if (bitmap.length === originalBitmap.length) {
				for (let offset = 0; offset < bitmap.length; offset += 4) {
					if (
						!bitmap.subarray(offset, offset + 4).equals(originalBitmap.subarray(offset, offset + 4))
					) {
						changedPixels++;
					}
				}
			}
			return { ...image.getSize(), changedPixels, empty: image.isEmpty() };
		},
		{ actual, reference },
	);
}

async function dragAcrossImage(page: Page, from: [number, number], to: [number, number]) {
	const canvas = page.getByTestId("screenshot-canvas").locator("canvas").first();
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Screenshot canvas has no bounds.");
	await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1]);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], {
		steps: 8,
	});
	await page.mouse.up();
	return bounds;
}

test("imports, edits, copies, crops and rotates an image at its original resolution", async () => {
	const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "openscreen-screenshot-e2e-"));
	const app = await electron.launch({
		args: [
			path.join(ROOT, "dist-electron/main.js"),
			"--no-sandbox",
			"--enable-unsafe-swiftshader",
			"--lang=en-US",
			`--user-data-dir=${path.join(testDirectory, "profile")}`,
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

		const sourcePath = path.join(testDirectory, "source.png");
		const dataUrl = await launch.evaluate(
			({ width, height }) => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas is unavailable.");
				context.fillStyle = "#eef2f6";
				context.fillRect(0, 0, width, height);
				context.fillStyle = "#263746";
				context.fillRect(width - 100, height - 100, 80, 80);
				context.font = "52px Arial, sans-serif";
				context.fillText("OpenScreen OCR tiếng Việt", 90, 120);
				return canvas.toDataURL("image/png");
			},
			{ width: WIDTH, height: HEIGHT },
		);
		fs.writeFileSync(sourcePath, Buffer.from(dataUrl.split(",")[1], "base64"));
		await app.evaluate(({ dialog, clipboard }, filePath) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
			clipboard.writeImage = (image) => {
				(globalThis as Record<string, unknown>)["screenshotTestClipboard"] = image.toDataURL();
			};
		}, sourcePath);

		const screenshotOpened = app.waitForEvent("window", {
			predicate: (page) => page.url().includes("windowType=screenshot"),
			timeout: 15_000,
		});
		await launch.getByTestId("launch-screenshot-button").click();
		const editor = await screenshotOpened;
		// Electron resolves beforeunload; Playwright must not dismiss its stale CDP dialog event.
		editor.on("dialog", (dialog) => {
			if (dialog.type() !== "beforeunload") void dialog.dismiss();
		});
		await editor.waitForLoadState("domcontentloaded");
		await editor.getByRole("button", { name: /Open image|Mở ảnh/i }).click();
		await expect(editor.getByTestId("screenshot-canvas")).toBeVisible();
		await expect(editor.getByTestId("screenshot-undo")).toBeDisabled();

		await editor.getByTestId("screenshot-ocr-run").click();
		await expect(editor.getByTestId("screenshot-ocr-overlay")).toBeVisible({ timeout: 30_000 });
		const recognizedText = await editor.getByTestId("screenshot-ocr-text").allTextContents();
		expect(recognizedText.join(" ")).toContain("OpenScreen");
		expect(
			await editor
				.getByTestId("screenshot-ocr-text")
				.first()
				.evaluate((element) => getComputedStyle(element).userSelect),
		).toBe("text");
		await editor.getByTestId("screenshot-ocr-toggle").click();
		await expect(editor.getByTestId("screenshot-ocr-overlay")).toHaveCount(0);
		await editor.getByTestId("screenshot-ocr-toggle").click();
		await expect(editor.getByTestId("screenshot-ocr-overlay")).toBeVisible();

		await editor.getByTestId("screenshot-tool-pen").click();
		await expect(editor.getByTestId("screenshot-ocr-overlay")).toHaveCount(0);
		await dragAcrossImage(editor, [0.3, 0.35], [0.6, 0.55]);
		await expect(editor.getByTestId("screenshot-undo")).toBeEnabled();
		await editor.keyboard.press("ControlOrMeta+z");
		await expect(editor.getByTestId("screenshot-redo")).toBeEnabled();
		const pristinePath = path.join(testDirectory, "pristine.png");
		await saveImage(app, editor, pristinePath);
		expect(await compareImages(app, pristinePath, sourcePath)).toEqual({
			width: WIDTH,
			height: HEIGHT,
			changedPixels: 0,
			empty: false,
		});

		await editor.keyboard.press("ControlOrMeta+Shift+z");
		await expect(editor.getByTestId("screenshot-redo")).toBeDisabled();
		const annotatedPath = path.join(testDirectory, "annotated.png");
		await saveImage(app, editor, annotatedPath);
		const annotated = await compareImages(app, annotatedPath, sourcePath);
		expect(annotated).toMatchObject({ width: WIDTH, height: HEIGHT, empty: false });
		expect(annotated.changedPixels).toBeGreaterThan(100);
		expect(fs.readFileSync(annotatedPath).subarray(0, 8)).toEqual(
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);

		await editor.getByTestId("screenshot-tool-select").click();
		const canvasBounds = await editor
			.getByTestId("screenshot-canvas")
			.locator("canvas")
			.first()
			.boundingBox();
		if (!canvasBounds) throw new Error("Screenshot canvas has no bounds.");
		await editor.mouse.click(
			canvasBounds.x + canvasBounds.width * 0.45,
			canvasBounds.y + canvasBounds.height * 0.45,
		);
		const selectedPath = path.join(testDirectory, "selected.png");
		await app.evaluate(({ dialog }, destination) => {
			dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
		}, selectedPath);
		await editor.keyboard.press("ControlOrMeta+s");
		await expect.poll(() => fs.existsSync(selectedPath)).toBe(true);
		await expect(editor.getByTestId("screenshot-save")).toBeEnabled();
		expect((await compareImages(app, selectedPath, annotatedPath)).changedPixels).toBe(0);
		fs.mkdirSync(path.join(ROOT, ".codex-run"), { recursive: true });
		await editor.screenshot({ path: path.join(ROOT, ".codex-run/screenshot-editor-preview.png") });

		await editor.getByTestId("screenshot-copy").click();
		await expect
			.poll(() =>
				app.evaluate(() =>
					Boolean((globalThis as Record<string, unknown>)["screenshotTestClipboard"]),
				),
			)
			.toBe(true);
		const clipboardMatches = await app.evaluate(({ nativeImage }, savedPath) => {
			const copied = nativeImage.createFromDataURL(
				String((globalThis as Record<string, unknown>)["screenshotTestClipboard"]),
			);
			return copied.toBitmap().equals(nativeImage.createFromPath(savedPath).toBitmap());
		}, annotatedPath);
		expect(clipboardMatches).toBe(true);

		const menuSavedPath = path.join(testDirectory, "menu-saved.png");
		await app.evaluate(({ BrowserWindow, Menu, dialog }, destination) => {
			const screenshot = BrowserWindow.getAllWindows().find((window) =>
				window.webContents.getURL().includes("windowType=screenshot"),
			);
			if (!screenshot) throw new Error("Screenshot window was closed.");
			const saveItem = Menu.getApplicationMenu()
				?.items.flatMap((item) => item.submenu?.items ?? [])
				.find((item) => item.accelerator === "CmdOrCtrl+S");
			if (!saveItem) throw new Error("Save menu item is unavailable.");
			dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
			const getFocusedWindow = BrowserWindow.getFocusedWindow;
			BrowserWindow.getFocusedWindow = () => screenshot;
			try {
				(saveItem.click as () => void)();
			} finally {
				BrowserWindow.getFocusedWindow = getFocusedWindow;
			}
		}, menuSavedPath);
		await expect.poll(() => fs.existsSync(menuSavedPath)).toBe(true);
		expect((await compareImages(app, menuSavedPath, annotatedPath)).changedPixels).toBe(0);

		await editor.getByTestId("screenshot-tool-crop").click();
		await dragAcrossImage(editor, [0.25, 0.25], [0.75, 0.75]);
		const cropLabel = await editor.getByText(/^\d+ × \d+ px$/).innerText();
		const selectedDimensions = cropLabel.match(/\d+/g)?.map(Number);
		expect(selectedDimensions).toHaveLength(2);
		await editor.getByTestId("screenshot-crop-apply").click();
		const croppedPath = path.join(testDirectory, "cropped.png");
		await saveImage(app, editor, croppedPath);
		const cropped = await compareImages(app, croppedPath, sourcePath);
		expect([cropped.width, cropped.height]).toEqual(selectedDimensions);
		await editor.getByTestId("screenshot-tool-rotate").click();
		const jpegPath = path.join(testDirectory, "cropped-rotated.jpg");
		await saveImage(app, editor, jpegPath, "jpeg");
		const rotated = await compareImages(app, jpegPath, sourcePath);
		expect(rotated.empty).toBe(false);
		expect([rotated.width, rotated.height]).toEqual([cropped.height, cropped.width]);
		expect(fs.readFileSync(jpegPath).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

		await editor.getByTestId("screenshot-tool-pen").click();
		await dragAcrossImage(editor, [0.2, 0.2], [0.35, 0.35]);
		const requestApplicationQuit = () =>
			app.evaluate(({ Menu }) => {
				const quitItem = Menu.getApplicationMenu()
					?.items.flatMap((item) => item.submenu?.items ?? [])
					.find((item) => item.label === "Quit");
				if (!quitItem?.click) throw new Error("Quit menu item is unavailable.");
				(quitItem.click as () => void)();
			});
		await requestApplicationQuit();
		await expect(editor.getByRole("dialog")).toBeVisible();
		await editor.keyboard.press("Escape");
		await expect(editor.getByRole("dialog")).not.toBeVisible();
		expect(editor.isClosed()).toBe(false);
		await requestApplicationQuit();
		await expect(editor.getByRole("dialog")).toBeVisible();
		await editor.getByRole("button", { name: /Keep editing|Tiếp tục chỉnh sửa/i }).click();
		await expect(editor.getByRole("dialog")).not.toBeVisible();
		expect(editor.isClosed()).toBe(false);
		await requestApplicationQuit();
		await expect(editor.getByRole("dialog")).toBeVisible();
		const appClosed = once(child, "close");
		await editor.getByRole("button", { name: /Discard image|Bỏ ảnh/i }).click();
		await appClosed;
		expect(launch.isClosed()).toBe(true);
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
		const resolvedDirectory = path.resolve(testDirectory);
		if (
			path.dirname(resolvedDirectory) === path.resolve(os.tmpdir()) &&
			path.basename(resolvedDirectory).startsWith("openscreen-screenshot-e2e-")
		) {
			fs.rmSync(resolvedDirectory, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	}
});
