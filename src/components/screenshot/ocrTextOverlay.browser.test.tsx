import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { ScreenshotOcrResult } from "@/native/contracts";
import ImageEditor from "./ImageEditor";

afterEach(cleanup);

beforeEach(() => {
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			setHasUnsavedChanges: vi.fn(),
			cancelPendingExit: vi.fn(),
		},
	});
});

function blankImage(width = 400, height = 200) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable.");
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	return { dataUrl: canvas.toDataURL("image/png"), width, height, name: "ocr.png" };
}

function mountEditor(onRecognize: (dataUrl: string) => Promise<ScreenshotOcrResult>) {
	return render(
		<I18nProvider>
			<ImageEditor
				image={blankImage()}
				onSave={async () => true}
				onCopy={async () => undefined}
				onRecognize={onRecognize}
				onBack={() => undefined}
			/>
		</I18nProvider>,
	);
}

async function waitForOcrButton() {
	return vi.waitFor(
		() => {
			const button = document.querySelector<HTMLButtonElement>(
				'[data-testid="screenshot-ocr-run"]',
			);
			expect(button).not.toBeNull();
			expect(button?.disabled).toBe(false);
			return button as HTMLButtonElement;
		},
		{ timeout: 10_000 },
	);
}

describe("image editor OCR overlay", () => {
	it("shows OCR progress and surfaces local service errors", async () => {
		let rejectOcr: ((reason: Error) => void) | undefined;
		mountEditor(
			() =>
				new Promise((_resolve, reject) => {
					rejectOcr = reject;
				}),
		);

		const button = await waitForOcrButton();
		button.click();
		await vi.waitFor(() => expect(button.disabled).toBe(true));
		await act(async () => rejectOcr?.(new Error("Local OCR is unavailable")));
		await vi.waitFor(() => expect(button.disabled).toBe(false));
		const alert = document.querySelector<HTMLElement>('[role="alert"]');
		expect(alert?.textContent).toContain("Local OCR is unavailable");
	});

	it("renders selectable OCR text at normalized coordinates and toggles it", async () => {
		mountEditor(async () => ({
			provider: "paddleocr-local",
			blocks: [
				{
					id: "line-1",
					text: "Chụp màn hình",
					confidence: 0.98,
					box: { x: 0.1, y: 0.2, width: 0.5, height: 0.15 },
				},
			],
		}));

		(await waitForOcrButton()).click();
		const text = await vi.waitFor(() => {
			const node = document.querySelector<HTMLElement>('[data-testid="screenshot-ocr-text"]');
			expect(node?.textContent).toBe("Chụp màn hình");
			return node as HTMLElement;
		});
		expect(text.style.left).toBe("10%");
		expect(text.style.top).toBe("20%");
		expect(text.style.width).toBe("50%");
		expect(text.style.height).toBe("15%");
		expect(Number.parseFloat(text.style.fontSize)).toBeCloseTo(
			text.getBoundingClientRect().height * 0.9,
			1,
		);
		const computedStyle = getComputedStyle(text);
		expect(computedStyle.backgroundColor).toBe("rgb(8, 127, 91)");
		expect(computedStyle.userSelect).toBe("text");

		const toggle = document.querySelector<HTMLButtonElement>(
			'[data-testid="screenshot-ocr-toggle"]',
		);
		expect(toggle?.getAttribute("aria-pressed")).toBe("true");
		toggle?.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="screenshot-ocr-overlay"]')).toBeNull(),
		);
		expect(toggle?.getAttribute("aria-pressed")).toBe("false");
		toggle?.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="screenshot-ocr-overlay"]')).not.toBeNull(),
		);
	});

	it("drops a stale OCR response after the image is rotated", async () => {
		let resolveOcr: ((result: ScreenshotOcrResult) => void) | undefined;
		mountEditor(
			() =>
				new Promise((resolve) => {
					resolveOcr = resolve;
				}),
		);

		(await waitForOcrButton()).click();
		const rotate = document.querySelector<HTMLButtonElement>(
			'[data-testid="screenshot-tool-rotate"]',
		);
		expect(rotate?.disabled).toBe(false);
		rotate?.click();
		await vi.waitFor(() => expect(resolveOcr).toBeTypeOf("function"));
		await act(async () => {
			resolveOcr?.({
				provider: "paddleocr-local",
				blocks: [
					{
						id: "stale",
						text: "stale text",
						confidence: 1,
						box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
					},
				],
			});
		});

		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="screenshot-ocr-overlay"]')).toBeNull(),
		);
		expect(document.body.textContent).not.toContain("stale text");
	});

	it("does not interrupt a drawing tool when OCR finishes", async () => {
		let resolveOcr: ((result: ScreenshotOcrResult) => void) | undefined;
		mountEditor(
			() =>
				new Promise((resolve) => {
					resolveOcr = resolve;
				}),
		);

		(await waitForOcrButton()).click();
		const pen = document.querySelector<HTMLButtonElement>('[data-testid="screenshot-tool-pen"]');
		expect(pen?.disabled).toBe(false);
		pen?.click();
		await vi.waitFor(() => expect(pen?.getAttribute("aria-pressed")).toBe("true"));

		await act(async () => {
			resolveOcr?.({
				provider: "tesseract-local",
				blocks: [
					{
						id: "line-1",
						text: "OCR finished",
						confidence: 0.99,
						box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
					},
				],
			});
		});

		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="screenshot-ocr-toggle"]')).not.toBeNull(),
		);
		expect(pen?.getAttribute("aria-pressed")).toBe("true");
		expect(document.querySelector('[data-testid="screenshot-ocr-overlay"]')).toBeNull();
	});
});
