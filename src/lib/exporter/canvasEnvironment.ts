/**
 * Environment-agnostic canvas helpers. The export pipeline runs unchanged on
 * the main thread (HTMLCanvasElement, GIF/overlay exporters) and inside a
 * dedicated Web Worker (OffscreenCanvas, MP4 export) so rendering never
 * blocks the UI.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyCanvas2dContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A drawable raster image in either environment. */
export type AnyImageSource = HTMLImageElement | ImageBitmap;

export const isOffscreenEnvironment = typeof document === "undefined";

export function createCanvas(width: number, height: number): AnyCanvas {
	if (isOffscreenEnvironment) {
		return new OffscreenCanvas(width, height);
	}
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

export function context2d(
	canvas: AnyCanvas,
	options?: { willReadFrequently?: boolean },
): AnyCanvas2dContext {
	if (isOffscreenEnvironment) {
		const ctx = (canvas as OffscreenCanvas).getContext(
			"2d",
			options,
		) as OffscreenCanvasRenderingContext2D | null;
		if (!ctx) throw new Error("Failed to acquire OffscreenCanvas 2D context");
		return ctx;
	}
	const ctx = (canvas as HTMLCanvasElement).getContext(
		"2d",
		options,
	) as CanvasRenderingContext2D | null;
	if (!ctx) throw new Error("Failed to acquire canvas 2D context");
	return ctx;
}

export interface LoadedRasterImage {
	source: AnyImageSource;
	width: number;
	height: number;
}

/**
 * Loads an image URL (http(s), app-relative asset, or data: URL) as a drawable
 * raster. Uses an HTMLImageElement on the main thread and an ImageBitmap in
 * workers, where the Image element does not exist.
 */
export async function loadRasterImage(src: string): Promise<LoadedRasterImage> {
	if (isOffscreenEnvironment) {
		const response = await fetch(src);
		if (!response.ok) {
			throw new Error(`Failed to load image (${response.status}): ${src}`);
		}
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob);
		return { source: bitmap, width: bitmap.width, height: bitmap.height };
	}

	const image = new Image();
	if (/^https?:/i.test(src) && !src.startsWith(window.location.origin)) {
		image.crossOrigin = "anonymous";
	}
	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
		image.src = src;
	});
	return { source: image, width: image.naturalWidth, height: image.naturalHeight };
}
