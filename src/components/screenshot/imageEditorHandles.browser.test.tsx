import { cleanup, render } from "@testing-library/react";
import Konva from "konva";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import ImageEditor from "./ImageEditor";

afterEach(cleanup);

let menuSaveHandler: (() => void) | undefined;

// Konva captures the pointer when a drag starts. A synthetic pointerId is not a
// real pointer, so the browser rejects the capture and the drag never begins.
beforeAll(() => {
	Element.prototype.setPointerCapture = () => undefined;
	Element.prototype.releasePointerCapture = () => undefined;
	Element.prototype.hasPointerCapture = () => true;
});

beforeEach(() => {
	menuSaveHandler = undefined;
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			setHasUnsavedChanges: vi.fn(),
			cancelPendingExit: vi.fn(),
			onMenuSaveProject: vi.fn((handler: () => void) => {
				menuSaveHandler = handler;
				return () => {
					if (menuSaveHandler === handler) menuSaveHandler = undefined;
				};
			}),
		},
	});
});

function blankImage(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable.");
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, width, height);
	return { dataUrl: canvas.toDataURL("image/png"), width, height, name: "test.png" };
}

function mountEditor(
	width = 400,
	height = 240,
	onSave: (dataUrl: string, format: "png" | "jpeg") => Promise<boolean> = async () => true,
) {
	const image = blankImage(width, height);
	const view = render(
		<I18nProvider>
			<ImageEditor
				image={image}
				onSave={onSave}
				onCopy={async () => undefined}
				onRecognize={async () => ({ provider: "paddleocr-local", blocks: [] })}
				onBack={() => undefined}
			/>
		</I18nProvider>,
	);
	return { view, image };
}

/**
 * Konva reads hit targets from pointer events on its content div but runs drags
 * from mouse events on the window, so a realistic gesture has to emit both, the
 * way a real pointer does.
 */
function fire(stage: Konva.Stage, phase: "down" | "move" | "up", x: number, y: number) {
	const rect = stage.content.getBoundingClientRect();
	const position = {
		clientX: rect.left + x * stage.scaleX(),
		clientY: rect.top + y * stage.scaleY(),
	};
	const shared = {
		...position,
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: phase === "up" ? 0 : 1,
	};
	stage.content.dispatchEvent(
		new PointerEvent(`pointer${phase}`, { ...shared, pointerId: 1, isPrimary: true }),
	);
	stage.content.dispatchEvent(new MouseEvent(`mouse${phase}`, shared));
}

function fireDoubleClick(stage: Konva.Stage, x: number, y: number) {
	// Konva synthesizes dblclick from two complete pointer gestures rather than
	// listening to the browser's native dblclick event on the canvas element.
	fire(stage, "down", x, y);
	fire(stage, "up", x, y);
	fire(stage, "down", x, y);
	fire(stage, "up", x, y);
}

async function editorStage(onSave?: (dataUrl: string, format: "png" | "jpeg") => Promise<boolean>) {
	mountEditor(400, 240, onSave);
	const button = document.querySelector<HTMLButtonElement>('[data-testid="screenshot-tool-text"]');
	if (!button) throw new Error("The editor toolbar did not render.");
	// The toolbar only enables once the bitmap has decoded.
	await vi.waitFor(() => expect(button.disabled).toBe(false), { timeout: 10_000 });
	// Other suites leave detached stages behind, so pick the one actually on screen.
	const stage = Konva.stages
		.filter((candidate) => document.body.contains(candidate.container()))
		.at(-1);
	if (!stage) throw new Error("The editor stage did not render.");
	return stage;
}

function click(testId: string) {
	document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
}

async function addSelectedText(stage: Konva.Stage, at: { x: number; y: number }) {
	click("screenshot-tool-text");
	// The field only exists while the text tool is active, and React renders it a
	// tick after the click.
	const field = await vi.waitFor(() => {
		const found = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="screenshot-text-input"]',
		);
		expect(found).not.toBeNull();
		return found as HTMLTextAreaElement;
	});
	const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
	setValue?.call(field, "Label");
	field.dispatchEvent(new Event("input", { bubbles: true }));
	// A controlled input keeps the typed value only once React has stored it, so
	// this also proves the editor is ready to commit the annotation.
	await vi.waitFor(() => expect(field.value).toBe("Label"));
	// A click with text ready commits the annotation, selects it, and returns the
	// editor to the select tool, which is where the handles appear.
	fire(stage, "down", at.x, at.y);
	fire(stage, "up", at.x, at.y);
	await vi.waitFor(() => expect(stage.find(".annotation")).toHaveLength(1), { timeout: 5_000 });
	return stage.findOne(".annotation") as Konva.Node;
}

async function openInlineTextEditor(stage: Konva.Stage) {
	const transformer = stage.findOne("Transformer") as Konva.Transformer;
	const back = transformer.findOne(".back");
	if (!back) throw new Error("The selection drag surface did not render.");
	const bounds = back.getClientRect({ relativeTo: stage });
	const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	await vi.waitFor(
		() =>
			expect(
				stage.getIntersection({ x: point.x * stage.scaleX(), y: point.y * stage.scaleY() }),
			).toBe(back),
		{ timeout: 5_000 },
	);
	fireDoubleClick(stage, point.x, point.y);
	return vi.waitFor(() => {
		const found = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="screenshot-inline-text-editor"]',
		);
		expect(found).not.toBeNull();
		return found as HTMLTextAreaElement;
	});
}

describe("professional image editor selection controls", () => {
	it("shows dedicated resize anchors and a separate rotation handle for text", async () => {
		const stage = await editorStage();
		await addSelectedText(stage, { x: 60, y: 60 });

		const transformer = stage.findOne("Transformer") as Konva.Transformer;
		await vi.waitFor(() => expect(transformer.nodes()).toHaveLength(1), { timeout: 5_000 });
		for (const name of ["top-left", "top-right", "bottom-left", "bottom-right", "rotater"]) {
			const handle = transformer.findOne(`.${name}`);
			expect(handle, `${name} handle`).toBeTruthy();
			expect(handle?.isListening()).toBe(true);
		}
		// Text now has conventional controls; the two combined rotate/scale
		// endpoints remain reserved for arrows and freehand vector strokes.
		expect(transformer.findOne(".top-center")?.visible()).toBe(false);
		expect(stage.find("Circle.annotation-handle")).toHaveLength(0);
	});

	it("bakes a standard transform into document geometry and resets Konva scale", async () => {
		const stage = await editorStage();
		const node = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const transformer = stage.findOne("Transformer") as Konva.Transformer;
		await vi.waitFor(() => expect(transformer.nodes()).toHaveLength(1), { timeout: 5_000 });
		const initialFontSize = node.fontSize();
		const resizeHandle = transformer.findOne(".bottom-right");
		if (!resizeHandle) throw new Error("The bottom-right resize handle did not render.");
		const bounds = resizeHandle.getClientRect({ relativeTo: stage });
		const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		await vi.waitFor(
			() =>
				expect(
					stage.getIntersection({ x: origin.x * stage.scaleX(), y: origin.y * stage.scaleY() }),
				).toBe(resizeHandle),
			{
				timeout: 5_000,
			},
		);
		fire(stage, "down", origin.x, origin.y);
		fire(stage, "move", origin.x + 45, origin.y + 30);
		fire(stage, "up", origin.x + 45, origin.y + 30);

		await vi.waitFor(() => expect(node.fontSize()).toBeGreaterThan(initialFontSize), {
			timeout: 5_000,
		});
		expect(node.scaleX()).toBe(1);
		expect(node.scaleY()).toBe(1);
		expect(node.rotation()).toBeCloseTo(0, 5);
	});

	it("moves a transformed annotation from anywhere inside its selection without resizing it", async () => {
		const stage = await editorStage();
		const node = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const transformer = stage.findOne("Transformer") as Konva.Transformer;
		await vi.waitFor(() => expect(transformer.nodes()).toHaveLength(1), { timeout: 5_000 });
		const rotater = transformer.findOne(".rotater");
		const back = transformer.findOne(".back");
		if (!rotater || !back) throw new Error("The selection controls did not render.");
		const rotaterBounds = rotater.getClientRect({ relativeTo: stage });
		const rotateFrom = {
			x: rotaterBounds.x + rotaterBounds.width / 2,
			y: rotaterBounds.y + rotaterBounds.height / 2,
		};
		const backBounds = back.getClientRect({ relativeTo: stage });
		const center = {
			x: backBounds.x + backBounds.width / 2,
			y: backBounds.y + backBounds.height / 2,
		};
		const radius = Math.hypot(rotateFrom.x - center.x, rotateFrom.y - center.y);
		await vi.waitFor(
			() =>
				expect(
					stage.getIntersection({
						x: rotateFrom.x * stage.scaleX(),
						y: rotateFrom.y * stage.scaleY(),
					}),
				).toBe(rotater),
			{ timeout: 5_000 },
		);
		fire(stage, "down", rotateFrom.x, rotateFrom.y);
		fire(stage, "move", center.x + radius, center.y);
		fire(stage, "up", center.x + radius, center.y);
		await vi.waitFor(() => expect(Math.abs(node.rotation())).toBeGreaterThan(45), {
			timeout: 5_000,
		});

		const before = {
			x: node.x(),
			y: node.y(),
			rotation: node.rotation(),
			fontSize: node.fontSize(),
			width: node.width(),
			height: node.height(),
		};
		const origin = back
			.getAbsoluteTransform(stage)
			.point({ x: back.width() / 2, y: back.height() / 2 });
		await vi.waitFor(
			() =>
				expect(
					stage.getIntersection({ x: origin.x * stage.scaleX(), y: origin.y * stage.scaleY() }),
				).toBe(back),
			{ timeout: 5_000 },
		);
		const target = { x: origin.x + 45, y: origin.y + 30 };
		fire(stage, "down", origin.x, origin.y);
		fire(stage, "move", target.x, target.y);
		fire(stage, "up", target.x, target.y);

		await vi.waitFor(() => expect(Math.abs(node.x() - (before.x + 45))).toBeLessThan(1), {
			timeout: 5_000,
		});
		expect(Math.abs(node.y() - (before.y + 30))).toBeLessThan(1);
		expect(node.rotation()).toBeCloseTo(before.rotation, 5);
		expect(node.fontSize()).toBeCloseTo(before.fontSize, 5);
		expect(node.width()).toBeCloseTo(before.width, 5);
		expect(node.height()).toBeCloseTo(before.height, 5);

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
		await vi.waitFor(() => expect(node.x()).toBeCloseTo(before.x, 5), { timeout: 5_000 });
		expect(node.y()).toBeCloseTo(before.y, 5);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true }));
		await vi.waitFor(() => expect(Math.abs(node.x() - (before.x + 45))).toBeLessThan(1), {
			timeout: 5_000,
		});
		expect(Math.abs(node.y() - (before.y + 30))).toBeLessThan(1);
	});

	it("edits multiline text directly on the canvas without changing its transform", async () => {
		const stage = await editorStage();
		const node = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const before = { x: node.x(), y: node.y(), rotation: node.rotation() };

		const editor = await openInlineTextEditor(stage);
		const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		setValue?.call(editor, "  First line\nSecond line  ");
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		await vi.waitFor(() => expect(editor.value).toBe("  First line\nSecond line  "));
		editor.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
		);

		await vi.waitFor(() => expect(node.text()).toBe("  First line\nSecond line  "), {
			timeout: 5_000,
		});
		expect(node.x()).toBeCloseTo(before.x, 5);
		expect(node.y()).toBeCloseTo(before.y, 5);
		expect(node.rotation()).toBeCloseTo(before.rotation, 5);
		expect(document.querySelector('[data-testid="screenshot-inline-text-editor"]')).toBeNull();
	});

	it("commits the inline draft before a native-menu save exports the content layer", async () => {
		let stage: Konva.Stage;
		let textSeenBySave = "";
		const onSave = vi.fn(async () => {
			textSeenBySave = (stage.findOne(".annotation") as Konva.Text).text();
			return true;
		});
		stage = await editorStage(onSave);
		const node = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const editor = await openInlineTextEditor(stage);
		const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		setValue?.call(editor, "Saved from the native menu");
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		await vi.waitFor(() => expect(node.text()).toBe("Saved from the native menu"));
		await vi.waitFor(() => expect(menuSaveHandler).toBeTypeOf("function"));

		menuSaveHandler?.();
		await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce(), { timeout: 5_000 });
		expect(textSeenBySave).toBe("Saved from the native menu");
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="screenshot-inline-text-editor"]')).toBeNull(),
		);
	});

	it("applies inspector values safely, duplicates, and changes paint order", async () => {
		const stage = await editorStage();
		const source = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const originalX = source.x();
		const xInput = document.querySelector<HTMLInputElement>(
			'[data-testid="screenshot-annotation-x"]',
		);
		const rotationInput = document.querySelector<HTMLInputElement>(
			'[data-testid="screenshot-annotation-rotation"]',
		);
		const textInput = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="screenshot-annotation-text"]',
		);
		if (!xInput || !rotationInput || !textInput) {
			throw new Error("The text inspector did not render.");
		}
		const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		const setTextarea = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		setInput?.call(xInput, "");
		xInput.dispatchEvent(new Event("input", { bubbles: true }));
		setInput?.call(rotationInput, "45");
		rotationInput.dispatchEvent(new Event("input", { bubbles: true }));
		setTextarea?.call(textInput, "Inspector\ntext");
		textInput.dispatchEvent(new Event("input", { bubbles: true }));
		await vi.waitFor(() => expect(textInput.value).toBe("Inspector\ntext"));
		click("screenshot-annotation-apply");

		await vi.waitFor(() => expect(source.text()).toBe("Inspector\ntext"), { timeout: 5_000 });
		expect(source.x()).toBeCloseTo(originalX, 5);
		expect(source.rotation()).toBeCloseTo(45, 5);

		click("screenshot-annotation-duplicate");
		await vi.waitFor(() => expect(stage.find(".annotation")).toHaveLength(2), { timeout: 5_000 });
		const duplicate = stage.find(".annotation")[1];
		await vi.waitFor(
			() => expect((stage.findOne("Transformer") as Konva.Transformer).nodes()[0]).toBe(duplicate),
			{ timeout: 5_000 },
		);
		click("screenshot-annotation-send-to-back");
		await vi.waitFor(() => expect(stage.find(".annotation")[0]).toBe(duplicate), {
			timeout: 5_000,
		});
	});

	it("duplicates and nudges the selected item without changing its transform", async () => {
		const stage = await editorStage();
		const source = (await addSelectedText(stage, { x: 60, y: 60 })) as Konva.Text;
		const before = {
			x: source.x(),
			y: source.y(),
			rotation: source.rotation(),
			fontSize: source.fontSize(),
		};

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));
		await vi.waitFor(() => expect(stage.find(".annotation")).toHaveLength(2), { timeout: 5_000 });
		const duplicate = stage.find(".annotation")[1] as Konva.Text;
		expect(duplicate.x()).toBeCloseTo(before.x + 12, 5);
		expect(duplicate.y()).toBeCloseTo(before.y + 12, 5);
		expect(duplicate.rotation()).toBe(before.rotation);
		expect(duplicate.fontSize()).toBe(before.fontSize);
		const transformer = stage.findOne("Transformer") as Konva.Transformer;
		await vi.waitFor(() => expect(transformer.nodes()[0]).toBe(duplicate), { timeout: 5_000 });

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true }));
		await vi.waitFor(() => expect(duplicate.x()).toBeCloseTo(before.x + 13, 5), {
			timeout: 5_000,
		});
		expect(duplicate.y()).toBeCloseTo(before.y + 22, 5);
		expect(duplicate.rotation()).toBe(before.rotation);
		expect(duplicate.fontSize()).toBe(before.fontSize);

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
		await vi.waitFor(() => expect(duplicate.y()).toBeCloseTo(before.y + 12, 5), {
			timeout: 5_000,
		});
		expect(duplicate.x()).toBeCloseTo(before.x + 13, 5);
	});
});
