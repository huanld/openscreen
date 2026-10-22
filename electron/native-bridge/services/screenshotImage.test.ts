import type { NativeImage } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	decodeScreenshotBuffer,
	decodeScreenshotDataUrl,
	screenshotImageResult,
} from "./screenshotImage";

const mocks = vi.hoisted(() => ({ createFromBuffer: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: mocks.createFromBuffer } }));

function pngHeader(width = 640, height = 360) {
	const bytes = Buffer.alloc(24);
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

function image(width = 640, height = 360) {
	return {
		isEmpty: () => false,
		getSize: vi.fn(() => ({ width, height })),
		getScaleFactors: () => [1],
		toPNG: vi.fn(() => pngHeader(width, height)),
	} as unknown as NativeImage;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createFromBuffer.mockReturnValue(image());
});

describe("screenshot image validation", () => {
	it.each([
		null,
		42,
		"https://example.com/image.png",
		"data:image/svg+xml;base64,PHN2Zy8+",
		"data:image/png;base64,%%%%",
	])("rejects unsupported image input %j", (input) => {
		expect(() => decodeScreenshotDataUrl(input)).toThrow();
		expect(mocks.createFromBuffer).not.toHaveBeenCalled();
	});

	it("rejects a MIME type that disagrees with the image bytes", () => {
		expect(() =>
			decodeScreenshotDataUrl(`data:image/jpeg;base64,${pngHeader().toString("base64")}`),
		).toThrow(/format/i);
		expect(mocks.createFromBuffer).not.toHaveBeenCalled();
	});

	it.each([
		[0, 360],
		[20000, 2],
		[8000, 8000],
	])("rejects unsafe PNG dimensions %i x %i before decoding", (width, height) => {
		expect(() => decodeScreenshotBuffer(pngHeader(width, height))).toThrow(/40 megapixels/i);
		expect(mocks.createFromBuffer).not.toHaveBeenCalled();
	});

	it("checks the decoded dimensions even when a small header passed validation", () => {
		mocks.createFromBuffer.mockReturnValue(image(20000, 20000));
		expect(() => decodeScreenshotBuffer(pngHeader())).toThrow(/40 megapixels/i);
	});

	it("reports malformed JPEG as invalid image data without reaching the native decoder", () => {
		expect(() => decodeScreenshotBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff]))).toThrow(
			/valid PNG or JPEG/i,
		);
		expect(mocks.createFromBuffer).not.toHaveBeenCalled();
	});

	it("rejects failed native decoding even when the header was readable", () => {
		mocks.createFromBuffer.mockReturnValue({ isEmpty: () => true });
		expect(() => decodeScreenshotBuffer(pngHeader())).toThrow(/could not be decoded/i);
	});
});

describe("screenshot capture image result", () => {
	it("uses the highest density representation so Retina screenshots keep native resolution", () => {
		const captured = image(2560, 1440);
		vi.spyOn(captured, "getScaleFactors").mockReturnValue([1, 2]);
		vi.mocked(captured.getSize).mockReturnValue({ width: 1280, height: 720 });
		const result = screenshotImageResult(captured, "Retina display");
		expect(result).toMatchObject({ width: 2560, height: 1440, name: "Retina display" });
		expect(captured.toPNG).toHaveBeenCalledWith({ scaleFactor: 2 });
	});

	it("reads exact encoded pixels when fractional DPI rounds the logical size", () => {
		const captured = image(1366, 768);
		vi.spyOn(captured, "getScaleFactors").mockReturnValue([1.25]);
		vi.mocked(captured.getSize).mockReturnValue({ width: 1092, height: 614 });
		const result = screenshotImageResult(captured, "125% display");
		expect(result).toMatchObject({ width: 1366, height: 768 });
		expect(captured.toPNG).toHaveBeenCalledWith({ scaleFactor: 1.25 });
	});

	it("reports an unavailable capture instead of accepting an empty thumbnail", () => {
		const captured = image();
		vi.spyOn(captured, "isEmpty").mockReturnValue(true);
		expect(() => screenshotImageResult(captured, "Screen")).toThrow(/empty image/i);
	});
});
