import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { KdenliveOverlayFrame } from "../../src/native/contracts";

const OVERLAY_FILE_PATTERN = "overlay_%06d.png";
const activeStages = new Map<string, string>();

function stageDirFor(token: string) {
	return path.join(app.getPath("temp"), `openscreen-kdenlive-overlay-${token}`);
}

function frameFile(index: number) {
	return `${OVERLAY_FILE_PATTERN.replace("%06d", String(Math.max(0, index)).padStart(6, "0"))}`;
}

async function removeDir(dir: string) {
	await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function beginKdenliveOverlayStage(): Promise<{ token: string }> {
	const token = randomUUID();
	const dir = stageDirFor(token);
	await fs.mkdir(dir, { recursive: true });
	await removeStaleStages();
	activeStages.set(token, dir);
	return { token };
}

export async function writeKdenliveOverlayStageFrame(frame: KdenliveOverlayFrame) {
	if (!frame || typeof frame.token !== "string" || !activeStages.has(frame.token)) {
		return { success: false, message: "The overlay staging session no longer exists." };
	}
	if (
		!Number.isSafeInteger(frame.index) ||
		frame.index < 0 ||
		frame.index > 100_000 ||
		!(frame.png instanceof ArrayBuffer) ||
		frame.png.byteLength === 0
	) {
		return { success: false, message: "Invalid overlay frame payload." };
	}
	try {
		await fs.writeFile(
			path.join(activeStages.get(frame.token)!, frameFile(frame.index)),
			Buffer.from(frame.png),
		);
		return { success: true };
	} catch (error) {
		console.error("Failed to stage Kdenlive overlay frame:", error);
		return { success: false, message: "Failed to write the overlay frame.", error: String(error) };
	}
}

export async function cancelKdenliveOverlayStage(token: string | undefined) {
	if (typeof token !== "string") return { success: true };
	const dir = activeStages.get(token);
	activeStages.delete(token);
	if (dir) await removeDir(dir);
	return { success: true };
}

/**
 * Moves a completed staging folder next to the saved .kdenlive project as
 * `<name>-overlay` and returns the MLT resource pattern plus frame count for
 * the handoff document. Cross-device moves fall back to a recursive copy.
 */
export async function finalizeKdenliveOverlayStage(
	token: string | undefined,
	projectFilePath: string,
): Promise<{ resource: string; frameCount: number } | null> {
	if (typeof token !== "string") return null;
	const stagedDir = activeStages.get(token);
	activeStages.delete(token);
	if (!stagedDir) return null;

	try {
		const files = (await fs.readdir(stagedDir)).filter((name) => name.endsWith(".png"));
		if (files.length === 0) {
			await removeDir(stagedDir);
			return null;
		}
		const frameCount = files.length;

		const baseName = path.basename(projectFilePath, path.extname(projectFilePath));
		const finalDir = path.join(path.dirname(projectFilePath), `${baseName}-overlay`);
		await removeDir(finalDir);
		try {
			await fs.rename(stagedDir, finalDir);
		} catch {
			// Rename can fail across volumes; fall back to a recursive copy.
			await fs.cp(stagedDir, finalDir, { recursive: true });
			await removeDir(stagedDir);
		}
		return { resource: path.join(finalDir, OVERLAY_FILE_PATTERN), frameCount };
	} catch (error) {
		console.error("Failed to finalize Kdenlive overlay staging:", error);
		await removeDir(stagedDir);
		return null;
	}
}

async function removeStaleStages() {
	// Sweep staging folders older than a day: crashed exports must not leak
	// gigabytes of PNG files in the temp directory.
	const tempDir = app.getPath("temp");
	let entries: string[] = [];
	try {
		entries = await fs.readdir(tempDir);
	} catch {
		return;
	}
	const now = Date.now();
	await Promise.all(
		entries
			.filter((name) => name.startsWith("openscreen-kdenlive-overlay-"))
			.map(async (name) => {
				const dir = path.join(tempDir, name);
				if (activeStages.has(name.slice("openscreen-kdenlive-overlay-".length))) return;
				try {
					const stats = await fs.stat(dir);
					if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) await removeDir(dir);
				} catch {
					/* already gone */
				}
			}),
	);
}
