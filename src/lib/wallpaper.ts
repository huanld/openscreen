import { getAssetPath } from "@/lib/assetPath";

export const WALLPAPER_COUNT = 18;

export const WALLPAPER_PATHS: readonly string[] = Array.from(
	{ length: WALLPAPER_COUNT },
	(_, i) => `/wallpapers/wallpaper${i + 1}.jpg`,
);

export const DEFAULT_WALLPAPER = WALLPAPER_PATHS[0];

export type WallpaperClassification =
	| { kind: "color"; value: string }
	| { kind: "gradient"; value: string }
	| { kind: "image"; path: string };

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\(/;
const COLOR_FUNC_RE = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/;
const IMAGE_URL_RE = /^(\/|https?:\/\/|file:\/\/|data:)/;

export function classifyWallpaper(value: string): WallpaperClassification {
	const trimmed = value.trim();
	if (trimmed === "") {
		return { kind: "color", value: "#000000" };
	}
	if (trimmed.startsWith("#") || COLOR_FUNC_RE.test(trimmed)) {
		return { kind: "color", value: trimmed };
	}
	if (GRADIENT_RE.test(trimmed)) {
		return { kind: "gradient", value: trimmed };
	}
	if (IMAGE_URL_RE.test(trimmed)) {
		return { kind: "image", path: trimmed };
	}
	return { kind: "color", value: trimmed };
}

const ALLOWED_IMAGE_PREFIX = "/wallpapers/";

export class UnsafeImagePrefixError extends Error {
	constructor(prefix: string) {
		super(`Image wallpaper path must live under ${prefix}`);
		this.name = "UnsafeImagePrefixError";
	}
}

export function resolveImageWallpaperUrl(imagePath: string): string {
	if (
		imagePath.startsWith("http://") ||
		imagePath.startsWith("https://") ||
		imagePath.startsWith("file://") ||
		imagePath.startsWith("data:")
	) {
		return imagePath;
	}
	const withLeadingSlash = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
	if (!withLeadingSlash.startsWith(ALLOWED_IMAGE_PREFIX)) {
		throw new BackgroundLoadError(imagePath, new UnsafeImagePrefixError(ALLOWED_IMAGE_PREFIX));
	}
	try {
		return getAssetPath(withLeadingSlash.slice(1));
	} catch (cause) {
		if (cause instanceof BackgroundLoadError) throw cause;
		throw new BackgroundLoadError(imagePath, cause);
	}
}

export class BackgroundLoadError extends Error {
	readonly url: string;
	readonly cause?: unknown;

	constructor(url: string, cause?: unknown) {
		super(`Failed to load background image: ${displayBasename(url)}`);
		this.name = "BackgroundLoadError";
		this.url = url;
		this.cause = cause;
	}

	get displayUrl(): string {
		return displayBasename(this.url);
	}
}

function displayBasename(url: string): string {
	if (url.startsWith("data:")) {
		return "data:…";
	}
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).pop();
		return last ? decodeURIComponent(last) : "(unknown)";
	} catch {
		const last = url.split("/").filter(Boolean).pop();
		return last ?? "(unknown)";
	}
}

const CUSTOM_BACKGROUNDS_KEY = "openscreen_custom_backgrounds";
const MAX_SAVED_CUSTOM_BACKGROUNDS = 8;

function isSavedCustomBackground(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("data:image/");
}

export function loadSavedCustomBackgrounds(): string[] {
	if (typeof window === "undefined" || !window.localStorage) {
		return [];
	}
	try {
		const raw = localStorage.getItem(CUSTOM_BACKGROUNDS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(isSavedCustomBackground).slice(0, MAX_SAVED_CUSTOM_BACKGROUNDS)
			: [];
	} catch {
		return [];
	}
}

export function saveCustomBackground(dataUrl: string): string[] {
	if (typeof window === "undefined" || !window.localStorage) {
		return [dataUrl];
	}
	try {
		const current = loadSavedCustomBackgrounds();
		const updated = [dataUrl, ...current.filter((url) => url !== dataUrl)].slice(
			0,
			MAX_SAVED_CUSTOM_BACKGROUNDS,
		);
		// Data URLs are large and localStorage quotas are small. Keep removing the
		// oldest thumbnail until the newest background can be persisted.
		for (let retained = updated.length; retained > 0; retained -= 1) {
			const candidate = updated.slice(0, retained);
			try {
				localStorage.setItem(CUSTOM_BACKGROUNDS_KEY, JSON.stringify(candidate));
				return candidate;
			} catch {
				// Retry with one fewer old background.
			}
		}
		return [dataUrl];
	} catch {
		return [dataUrl];
	}
}

export function removeSavedCustomBackground(dataUrl: string): string[] {
	if (typeof window === "undefined" || !window.localStorage) {
		return [];
	}
	try {
		const current = loadSavedCustomBackgrounds();
		const updated = current.filter((url) => url !== dataUrl);
		localStorage.setItem(CUSTOM_BACKGROUNDS_KEY, JSON.stringify(updated));
		return updated;
	} catch {
		return [];
	}
}
