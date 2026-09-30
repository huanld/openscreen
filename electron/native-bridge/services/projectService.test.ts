import { describe, expect, it, vi } from "vitest";
import type { KdenliveProjectExportRequest } from "../../../src/native/contracts";
import type { NativeBridgeStateStore } from "../store";
import { ProjectService } from "./projectService";

function createService(exportKdenliveProject = vi.fn()) {
	return new ProjectService({
		store: { setProjectContext: vi.fn() } as unknown as NativeBridgeStateStore,
		getCurrentProjectPath: () => null,
		getCurrentVideoPath: () => null,
		saveProjectFile: vi.fn(),
		exportKdenliveProject,
		loadProjectFile: vi.fn(),
		loadCurrentProjectFile: vi.fn(),
		setCurrentVideoPath: vi.fn(),
		getCurrentVideoPathResult: vi.fn(),
		clearCurrentVideoPath: vi.fn(),
	});
}

describe("ProjectService.exportKdenliveProject", () => {
	it("delegates one atomic export request and returns its result", async () => {
		const expected = { success: true, path: "C:\\Exports\\demo.kdenlive" };
		const exportKdenliveProject = vi.fn().mockResolvedValue(expected);
		const service = createService(exportKdenliveProject);
		const request: KdenliveProjectExportRequest = {
			handoff: {
				name: "Demo",
				screenSourcePath: "C:\\Recordings\\demo.webm",
				durationMs: 1_000,
			},
			suggestedName: "demo",
		};

		await expect(service.exportKdenliveProject(request)).resolves.toEqual(expected);
		expect(exportKdenliveProject).toHaveBeenCalledOnce();
		expect(exportKdenliveProject).toHaveBeenCalledWith(request);
	});
});
