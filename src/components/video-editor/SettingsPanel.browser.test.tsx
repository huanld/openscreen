import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { SLIDE_THEME_PRESETS } from "@/lib/slideThemes";
import { SettingsPanel } from "./SettingsPanel";
import "@/index.css";

afterEach(cleanup);

function renderExportPanel(
	onExportKdenlive = vi.fn(),
	isExportingKdenlive = false,
	panelSize?: { width: number; height: number },
	onExportQualityChange = vi.fn(),
) {
	render(
		<div
			data-testid="settings-panel-host"
			style={panelSize ? { width: panelSize.width, height: panelSize.height } : undefined}
		>
			<I18nProvider>
				<ShortcutsProvider>
					<SettingsPanel
						selected="solid:#000000"
						onWallpaperChange={() => undefined}
						aspectRatio="16:9"
						onExportKdenlive={onExportKdenlive}
						isExportingKdenlive={isExportingKdenlive}
						onExportQualityChange={onExportQualityChange}
					/>
				</ShortcutsProvider>
			</I18nProvider>
		</div>,
	);
	fireEvent.click(screen.getByTestId("testId-export-panel-button"));
	return onExportKdenlive;
}

describe("SettingsPanel Kdenlive handoff", () => {
	it("offers working 720p, 1080p Full HD and 2K presets without 4K", () => {
		const onExportQualityChange = vi.fn();
		renderExportPanel(vi.fn(), false, undefined, onExportQualityChange);

		expect(screen.getByText("720p HD")).not.toBeNull();
		expect(screen.getByText("1080p Full HD")).not.toBeNull();
		fireEvent.click(screen.getByText("2K"));
		expect(onExportQualityChange).toHaveBeenCalledWith("ultra");
		expect(screen.queryByText("4K")).toBeNull();
	});

	it("shows the compatibility guidance and invokes the handoff", () => {
		const onExportKdenlive = renderExportPanel();
		const button = screen.getByTestId("testId-export-kdenlive-button");

		expect(button.textContent).toContain("Export to Kdenlive (.kdenlive)");
		expect(screen.getByText(/baked into a transparent overlay track/i)).not.toBeNull();
		fireEvent.click(button);
		expect(onExportKdenlive).toHaveBeenCalledOnce();
	});

	it("disables duplicate exports while the handoff is being prepared", () => {
		renderExportPanel(vi.fn(), true);
		const button = screen.getByTestId("testId-export-kdenlive-button") as HTMLButtonElement;

		expect(button.disabled).toBe(true);
		expect(button.textContent).toContain("Preparing Kdenlive timeline");
	});

	it("keeps the mode rail and Kdenlive action visible in a compact inspector", () => {
		renderExportPanel(vi.fn(), false, { width: 286, height: 180 });

		const hostRect = screen.getByTestId("settings-panel-host").getBoundingClientRect();
		const shellRect = screen.getByTestId("testId-settings-panel-shell").getBoundingClientRect();
		const railRect = screen.getByTestId("testId-settings-mode-rail").getBoundingClientRect();
		const exportPanelRect = screen
			.getByTestId("testId-export-panel-button")
			.getBoundingClientRect();
		const exportRect = screen.getByTestId("testId-export-button").getBoundingClientRect();
		const kdenliveRect = screen
			.getByTestId("testId-export-kdenlive-button")
			.getBoundingClientRect();

		expect(shellRect.width).toBeCloseTo(hostRect.width, 0);
		expect(shellRect.height).toBeCloseTo(hostRect.height, 0);
		expect(railRect.height).toBeGreaterThanOrEqual(shellRect.height - 2);
		expect(railRect.top).toBeGreaterThanOrEqual(shellRect.top);
		expect(railRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
		expect(exportPanelRect.width).toBeGreaterThan(0);
		expect(exportPanelRect.height).toBeGreaterThan(0);
		expect(exportPanelRect.top).toBeGreaterThanOrEqual(shellRect.top);
		expect(exportPanelRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
		expect(exportRect.top).toBeGreaterThanOrEqual(shellRect.top);
		expect(exportRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
		expect(exportRect.left).toBeGreaterThanOrEqual(railRect.right - 1);
		expect(exportRect.right).toBeLessThanOrEqual(shellRect.right);
		expect(kdenliveRect.top).toBeGreaterThanOrEqual(shellRect.top);
		expect(kdenliveRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
		expect(kdenliveRect.left).toBeGreaterThanOrEqual(railRect.right - 1);
		expect(kdenliveRect.right).toBeLessThanOrEqual(shellRect.right);
		expect(kdenliveRect.top).toBeGreaterThanOrEqual(exportRect.bottom);
	});

	it("keeps recorded-session guide and export controls side by side at 800px", async () => {
		await page.viewport(800, 600);
		try {
			render(
				<div className="editor-main-deck" style={{ height: 300 }}>
					<div />
					<div
						data-testid="responsive-settings-rail"
						className="editor-settings-rail editor-settings-rail--with-guide flex min-w-0 h-full flex-col gap-3"
					>
						<section
							data-testid="responsive-guide-panel"
							className="editor-guide-panel editor-inspector-shell flex max-h-[320px] min-h-[246px] shrink-0 flex-col overflow-hidden"
						/>
						<div
							data-testid="responsive-settings-slot"
							className="editor-settings-panel-slot min-h-0 flex-1 overflow-hidden"
						>
							<I18nProvider>
								<ShortcutsProvider>
									<SettingsPanel
										selected="solid:#000000"
										onWallpaperChange={() => undefined}
										aspectRatio="16:9"
										onExportKdenlive={() => undefined}
									/>
								</ShortcutsProvider>
							</I18nProvider>
						</div>
					</div>
				</div>,
			);
			fireEvent.click(screen.getByTestId("testId-export-panel-button"));

			const railRect = screen.getByTestId("responsive-settings-rail").getBoundingClientRect();
			const guideRect = screen.getByTestId("responsive-guide-panel").getBoundingClientRect();
			const slotRect = screen.getByTestId("responsive-settings-slot").getBoundingClientRect();
			const shellRect = screen.getByTestId("testId-settings-panel-shell").getBoundingClientRect();
			const exportRect = screen.getByTestId("testId-export-button").getBoundingClientRect();
			const kdenliveRect = screen
				.getByTestId("testId-export-kdenlive-button")
				.getBoundingClientRect();

			expect(railRect.height).toBeCloseTo(180, 0);
			expect(guideRect.top).toBeGreaterThanOrEqual(railRect.top);
			expect(guideRect.bottom).toBeLessThanOrEqual(railRect.bottom);
			expect(slotRect.top).toBeGreaterThanOrEqual(railRect.top);
			expect(slotRect.bottom).toBeLessThanOrEqual(railRect.bottom);
			expect(slotRect.left).toBeGreaterThanOrEqual(guideRect.right);
			expect(shellRect.height).toBeCloseTo(slotRect.height, 0);
			expect(exportRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
			expect(kdenliveRect.bottom).toBeLessThanOrEqual(shellRect.bottom);
			expect(kdenliveRect.top).toBeGreaterThanOrEqual(exportRect.bottom);
		} finally {
			await page.viewport(1280, 720);
		}
	});
});

describe("SettingsPanel selected video component", () => {
	it("edits fit mode, crop and frame ratio for only the selected video", () => {
		const onAppearanceChange = vi.fn();
		const onAppearancePreview = vi.fn();
		const onAspectRatioChange = vi.fn();
		render(
			<I18nProvider>
				<ShortcutsProvider>
					<SettingsPanel
						selected="solid:#000000"
						onWallpaperChange={() => undefined}
						aspectRatio="16:9"
						selectedVideoRegion={{
							id: "phone-video",
							startMs: 0,
							endMs: 5000,
							sourcePath: "phone.mp4",
							name: "phone.mp4",
							sourceDurationMs: 5000,
							sourceWidth: 1080,
							sourceHeight: 1920,
							position: { x: 10, y: 10 },
							size: { width: 36, height: 64 },
							fitMode: "cover",
							frameAspectRatio: "source",
							cropPosition: { x: 50, y: 50 },
							cropZoom: 1,
							zIndex: 1,
						}}
						onVideoRegionAppearanceChange={(_id, patch) => onAppearanceChange(patch)}
						onVideoRegionAppearancePreview={(_id, patch) => onAppearancePreview(patch)}
						onVideoRegionAppearanceCommit={() => undefined}
						onVideoRegionAspectRatioChange={(_id, ratio) => onAspectRatioChange(ratio)}
						onVideoRegionDelete={() => undefined}
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		expect(screen.getByText("phone.mp4")).not.toBeNull();
		fireEvent.click(screen.getByText("Fit frame"));
		expect(onAppearanceChange).toHaveBeenCalledWith({ fitMode: "contain", cropZoom: 1 });

		fireEvent.change(screen.getByLabelText("Frame ratio"), { target: { value: "9:16" } });
		expect(onAspectRatioChange).toHaveBeenCalledWith("9:16");

		fireEvent.click(screen.getByLabelText("Crop position 100, 50"));
		expect(onAppearanceChange).toHaveBeenCalledWith({ cropPosition: { x: 100, y: 50 } });
	});
});

describe("SettingsPanel slide design tools", () => {
	it("applies a theme and its framing as one editor operation", () => {
		const onApplySlideDesign = vi.fn();
		render(
			<I18nProvider>
				<ShortcutsProvider>
					<SettingsPanel
						selected=""
						onWallpaperChange={() => undefined}
						onApplySlideDesign={onApplySlideDesign}
						aspectRatio="16:9"
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.click(screen.getByText("Keynote Dark"));

		expect(onApplySlideDesign).toHaveBeenCalledOnce();
		expect(onApplySlideDesign).toHaveBeenCalledWith({
			wallpaper: SLIDE_THEME_PRESETS[0].value,
			padding: 18,
			borderRadius: 16,
			shadowIntensity: 1.2,
		});
	});

	it("applies a Canva portrait frame as one editor operation", () => {
		const onApplySlideDesign = vi.fn();
		render(
			<I18nProvider>
				<ShortcutsProvider>
					<SettingsPanel
						selected=""
						onWallpaperChange={() => undefined}
						onApplySlideDesign={onApplySlideDesign}
						aspectRatio="16:9"
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		fireEvent.click(screen.getByText("Canva 9:16"));

		expect(onApplySlideDesign).toHaveBeenCalledWith({
			aspectRatio: "9:16",
			padding: 16,
			borderRadius: 22,
			shadowIntensity: 1.2,
		});
	});

	it("inserts an uploaded image as an editable slide object", async () => {
		const onAddImageAnnotation = vi.fn();
		render(
			<I18nProvider>
				<ShortcutsProvider>
					<SettingsPanel
						selected=""
						onWallpaperChange={() => undefined}
						onAddImageAnnotation={onAddImageAnnotation}
						aspectRatio="16:9"
					/>
				</ShortcutsProvider>
			</I18nProvider>,
		);

		const input = screen.getByTestId("slide-overlay-file-input") as HTMLInputElement;
		fireEvent.change(input, {
			target: { files: [new File(["image"], "logo.webp", { type: "image/webp" })] },
		});

		await vi.waitFor(() => expect(onAddImageAnnotation).toHaveBeenCalledOnce());
		expect(onAddImageAnnotation.mock.calls[0][0]).toMatch(/^data:image\/webp;base64,/);
	});
});
