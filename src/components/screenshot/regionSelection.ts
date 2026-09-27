import type { ScreenshotRegion } from "@/native/contracts";

interface Point {
	x: number;
	y: number;
}

/** Coordinates are CSS pixels inside the overlay; the native service crops the full-size image. */
export function regionFromDrag(
	start: Point,
	end: Point,
	viewport: { width: number; height: number },
	minimumSize = 4,
): ScreenshotRegion | null {
	if (![start.x, start.y, end.x, end.y, viewport.width, viewport.height].every(Number.isFinite))
		return null;
	if (viewport.width <= 0 || viewport.height <= 0) return null;
	const clampX = (value: number) => Math.max(0, Math.min(viewport.width, value));
	const clampY = (value: number) => Math.max(0, Math.min(viewport.height, value));
	const left = Math.min(clampX(start.x), clampX(end.x));
	const top = Math.min(clampY(start.y), clampY(end.y));
	const width = Math.abs(clampX(start.x) - clampX(end.x));
	const height = Math.abs(clampY(start.y) - clampY(end.y));
	if (width <= 0 || height <= 0 || width < minimumSize || height < minimumSize) return null;
	return {
		x: left / viewport.width,
		y: top / viewport.height,
		width: width / viewport.width,
		height: height / viewport.height,
	};
}
