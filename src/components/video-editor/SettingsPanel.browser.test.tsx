import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { SettingsPanel } from "./SettingsPanel";
import "@/index.css";

afterEach(cleanup);

function renderExportPanel(
	onExportKdenlive = vi.fn(),
	isExportingKdenlive = false,
	panelSize?: { width: number; height: number },
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
					/>
				</ShortcutsProvider>
			</I18nProvider>
		</div>,
	);
	fireEvent.click(screen.getByTestId("testId-export-panel-button"));
	return onExportKdenlive;
}

describe("SettingsPanel Kdenlive handoff", () => {
	it("shows the compatibility guidance and invokes the handoff", () => {
		const onExportKdenlive = renderExportPanel();
		const button = screen.getByTestId("testId-export-kdenlive-button");

		expect(button.textContent).toContain("Export to Kdenlive (.otio)");
		expect(screen.getByText(/Kdenlive does not apply OpenScreen visual effects/i)).not.toBeNull();
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
