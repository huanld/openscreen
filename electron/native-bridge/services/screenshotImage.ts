import { type NativeImage, nativeImage } from "electron";
import type { NativeBridgeErrorCode, ScreenshotImage } from "../../../src/native/contracts";

export const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
export const MAX_SCREENSHOT_PIXELS = 40_000_000;
export const MAX_SCREENSHOT_DIMENSION = 16_384;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class ScreenshotError extends Error {
	constructor(
		readonly code: NativeBridgeErrorCode,
		message: string,
		readonly retryable = false,
	) {
		super(message);
		this.name = "ScreenshotError";
	}
}

export function validateScreenshotSize(width: number, height: number) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width <= 0 ||
		height <= 0 ||
		width > MAX_SCREENSHOT_DIMENSION ||
		height > MAX_SCREENSHOT_DIMENSION ||
		width * height > MAX_SCREENSHOT_PIXELS
	) {
		throw new ScreenshotError(
			"INVALID_REQUEST",
			"Image must be at most 40 megapixels and 16384 pixels per side.",
		);
	}
}

function readImageSize(bytes: Buffer): { width: number; height: number } {
	if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
		if (bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR") {
			return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
		}
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 3 < bytes.length && bytes[offset] === 0xff) {
			while (bytes[offset] === 0xff) offset++;
			const marker = bytes[offset++];
			if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			const length = bytes.readUInt16BE(offset);
			if (length < 2 || offset + length > bytes.length) break;
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
				if (length < 8) break;
				return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
			}
			offset += length;
		}
	}
	throw new ScreenshotError("INVALID_REQUEST", "Choose a valid PNG or JPEG image.");
}

export function decodeScreenshotBuffer(bytes: Buffer): NativeImage {
	if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
		throw new ScreenshotError("INVALID_REQUEST", "Image must be smaller than 64 MB.");
	}
	// Inspect dimensions before allocating the decoded bitmap.
	const size = readImageSize(bytes);
	validateScreenshotSize(size.width, size.height);
	const image = nativeImage.createFromBuffer(bytes);
	if (image.isEmpty())
		throw new ScreenshotError("INVALID_REQUEST", "The image could not be decoded.");
	const decodedSize = image.getSize();
	validateScreenshotSize(decodedSize.width, decodedSize.height);
	return image;
}

export function decodeScreenshotDataUrl(input: unknown): NativeImage {
	if (typeof input !== "string" || input.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 32) {
		throw new ScreenshotError(
			"INVALID_REQUEST",
			"Image must be a PNG or JPEG data URL smaller than 64 MB.",
		);
	}
	const prefix = /^data:image\/(png|jpeg);base64,/.exec(input);
	if (!prefix)
		throw new ScreenshotError("INVALID_REQUEST", "Only PNG and JPEG image data is supported.");
	const encoded = input.slice(prefix[0].length);
	if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
		throw new ScreenshotError("INVALID_REQUEST", "The image data is invalid.");
	}
	const bytes = Buffer.from(encoded, "base64");
	const isPng = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
	if ((prefix[1] === "png") !== isPng) {
		throw new ScreenshotError("INVALID_REQUEST", "Image data does not match its declared format.");
	}
	return decodeScreenshotBuffer(bytes);
}

export function screenshotImageResult(image: NativeImage, name: string): ScreenshotImage {
	if (image.isEmpty())
		throw new ScreenshotError(
			"UNAVAILABLE",
			"The source returned an empty image. Try another screen or window.",
			true,
		);
	const scaleFactor = Math.max(...image.getScaleFactors(), 1);
	const png = image.toPNG({ scaleFactor });
	// NativeImage.getSize() is expressed in rounded device-independent pixels.
	// The encoded header is authoritative at fractional display scale factors.
	const { width, height } = readImageSize(png);
	validateScreenshotSize(width, height);
	if (png.length > MAX_SCREENSHOT_BYTES) {
		throw new ScreenshotError("INVALID_REQUEST", "The captured image exceeds 64 MB.");
	}
	return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, width, height, name };
}
