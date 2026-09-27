import { describe, expect, it, vi } from "vitest";
import type { KdenliveOtioExportRequest } from "../../../src/native/contracts";
import type { NativeBridgeStateStore } from "../store";
import { ProjectService } from "./projectService";

function createService(exportKdenliveOtio = vi.fn()) {
	return new ProjectService({
		store: { setProjectContext: vi.fn() } as unknown as NativeBridgeStateStore,
		getCurrentProjectPath: () => null,
		getCurrentVideoPath: () => null,
		saveProjectFile: vi.fn(),
		exportKdenliveOtio,
		loadProjectFile: vi.fn(),
		loadCurrentProjectFile: vi.fn(),
		setCurrentVideoPath: vi.fn(),
		getCurrentVideoPathResult: vi.fn(),
		clearCurrentVideoPath: vi.fn(),
	});
}

describe("ProjectService.exportKdenliveOtio", () => {
	it("delegates one atomic export request and returns its result", async () => {
		const expected = { success: true, path: "C:\\Exports\\demo.otio" };
		const exportKdenliveOtio = vi.fn().mockResolvedValue(expected);
		const service = createService(exportKdenliveOtio);
		const request: KdenliveOtioExportRequest = {
			handoff: {
				name: "Demo",
				screenSourcePath: "C:\\Recordings\\demo.webm",
				durationMs: 1_000,
			},
			suggestedName: "demo-kdenlive",
		};

		await expect(service.exportKdenliveOtio(request)).resolves.toEqual(expected);
		expect(exportKdenliveOtio).toHaveBeenCalledOnce();
		expect(exportKdenliveOtio).toHaveBeenCalledWith(request);
	});
});
