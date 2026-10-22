const SUPPORTED_BACKGROUND_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
]);
const SUPPORTED_BACKGROUND_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const BACKGROUND_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export function isSupportedBackgroundImageType(type: string, fileName: string): boolean {
	const normalizedType = type.trim().toLowerCase();
	if (SUPPORTED_BACKGROUND_IMAGE_TYPES.has(normalizedType)) {
		return true;
	}

	if (normalizedType) {
		return false;
	}

	const lowerName = fileName.trim().toLowerCase();
	return [...SUPPORTED_BACKGROUND_IMAGE_EXTENSIONS].some((extension) =>
		lowerName.endsWith(extension),
	);
}
