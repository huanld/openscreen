import { normalizeTextAnimation } from "@/lib/annotationTextAnimation";
import { isSlideTransitionType, MAX_SLIDE_TRANSITION_DURATION_MS } from "@/lib/blankSlides";
import { normalizeBlurColor, normalizeBlurType } from "@/lib/blurEffects";
import { normalizeCursorThemeId } from "@/lib/cursor/cursorThemes";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { normalizeMediaClipTiming } from "@/lib/mediaClipTiming";
import type { ProjectMedia } from "@/lib/recordingSession";
import { normalizeProjectMedia } from "@/lib/recordingSession";
import { DEFAULT_WALLPAPER, WALLPAPER_PATHS } from "@/lib/wallpaper";
import { ASPECT_RATIOS, type AspectRatio, isPortraitAspectRatio } from "@/utils/aspectRatioUtils";
import {
	DEFAULT_EDITOR_APPEARANCE_SETTINGS,
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_WEBCAM_SETTINGS,
} from "./editorDefaults";
import { normalizeLane } from "./timeline/annotationTracks";
import {
	type AnnotationRegion,
	type AudioRegion,
	type BlankSlideRegion,
	type CropRegion,
	clampPlaybackSpeed,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_BLOCK_SIZE,
	DEFAULT_BLUR_DATA,
	DEFAULT_BLUR_FREEHAND_POINTS,
	DEFAULT_BLUR_INTENSITY,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PEN_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_RECTANGLE_FIGURE_DATA,
	DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM,
	DEFAULT_VIDEO_POSITION,
	DEFAULT_VIDEO_SCALE,
	DEFAULT_WEBCAM_MIRRORED,
	DEFAULT_WEBCAM_REACTIVE_ZOOM,
	DEFAULT_ZOOM_DEPTH,
	DEFAULT_ZOOM_MOTION_BLUR,
	MAX_BLUR_BLOCK_SIZE,
	MAX_BLUR_INTENSITY,
	MAX_PLAYBACK_SPEED,
	MAX_RECTANGLE_SPOTLIGHT_ZOOM,
	MAX_VIDEO_SCALE,
	MIN_BLUR_BLOCK_SIZE,
	MIN_BLUR_INTENSITY,
	MIN_PLAYBACK_SPEED,
	MIN_RECTANGLE_SPOTLIGHT_ZOOM,
	MIN_VIDEO_SCALE,
	type SpeedRegion,
	type TrimRegion,
	type VideoPosition,
	type VideoRegion,
	type VideoRegionAspectRatio,
	type VideoTransformKeyframe,
	type WebcamLayoutPreset,
	type WebcamMaskShape,
	type WebcamPosition,
	type WebcamSizePreset,
	type ZoomRegion,
} from "./types";

const VALID_BLUR_SHAPES = new Set(["rectangle", "oval", "freehand"] as const);
const VALID_VIDEO_REGION_ASPECT_RATIOS = new Set<VideoRegionAspectRatio>([
	"free",
	"source",
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"1:1",
]);

// Old projects persisted machine-specific file:// URLs for bundled wallpapers.
// Match only the known install layouts (packaged resources/[assets/]wallpapers,
// dev public/wallpapers) so a user's own file under some "wallpapers" folder isn't
// silently replaced.
const LEGACY_FILE_WALLPAPER_RE =
	/^file:\/\/.*?\/(?:resources\/(?:assets\/)?|public\/)wallpapers\/(wallpaper\d+\.jpg)$/i;
const CANONICAL_WALLPAPERS = new Set(WALLPAPER_PATHS);

function normalizeWallpaperValue(value: string): string {
	const match = LEGACY_FILE_WALLPAPER_RE.exec(value);
	if (!match) return value;
	const canonical = `/wallpapers/${match[1]}`;
	return CANONICAL_WALLPAPERS.has(canonical) ? canonical : DEFAULT_WALLPAPER;
}

export const PROJECT_VERSION = 2;

export interface ProjectEditorState {
	wallpaper: string;
	shadowIntensity: number;
	showBlur: boolean;
	showTrimWaveform: boolean;
	motionBlurAmount: number;
	borderRadius: number;
	padding: number;
	videoPosition?: VideoPosition | null;
	videoScale?: number;
	videoTransformKeyframes: VideoTransformKeyframe[];
	cropRegion: CropRegion;
	zoomRegions: ZoomRegion[];
	autoZoomEnabled: boolean;
	autoFocusAll: boolean;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	videoRegions: VideoRegion[];
	blankSlideRegions: BlankSlideRegion[];
	aspectRatio: AspectRatio;
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamMaskShape: WebcamMaskShape;
	webcamMirrored: boolean;
	webcamReactiveZoom: boolean;
	webcamSizePreset: WebcamSizePreset;
	webcamPosition: WebcamPosition | null;
	exportQuality: ExportQuality;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	cursorTheme: string;
}

export interface EditorProjectData {
	version: number;
	media?: ProjectMedia;
	editor: ProjectEditorState;
	videoPath?: string;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function computeNormalizedWebcamLayoutPreset(
	webcamLayoutPreset: Partial<ProjectEditorState>["webcamLayoutPreset"],
	normalizedAspectRatio: AspectRatio,
): WebcamLayoutPreset {
	switch (webcamLayoutPreset) {
		case "picture-in-picture":
		case "no-webcam":
			return webcamLayoutPreset;
		case "vertical-stack":
			return isPortraitAspectRatio(normalizedAspectRatio)
				? webcamLayoutPreset
				: DEFAULT_WEBCAM_SETTINGS.layoutPreset;
		case "dual-frame":
			return isPortraitAspectRatio(normalizedAspectRatio)
				? DEFAULT_WEBCAM_SETTINGS.layoutPreset
				: webcamLayoutPreset;
		default:
			return DEFAULT_WEBCAM_SETTINGS.layoutPreset;
	}
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
	return pathname
		.split("/")
		.map((segment, index) => {
			if (!segment) {
				return segment;
			}
			if (keepWindowsDrive && index === 0 && /^[a-zA-Z]:$/.test(segment)) {
				return segment;
			}
			return encodeURIComponent(segment);
		})
		.join("/");
}

export function toFileUrl(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	if (normalized.match(/^[a-zA-Z]:/)) {
		return `file:///${encodePathSegments(normalized, true)}`;
	}
	if (normalized.startsWith("//")) {
		const withoutPrefix = normalized.slice(2);
		const [host = "", ...segments] = withoutPrefix.split("/");
		return `file://${host}/${encodePathSegments(segments.join("/"))}`;
	}
	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `file://${encodePathSegments(absolutePath)}`;
}

export function fromFileUrl(fileUrl: string): string {
	if (!fileUrl.startsWith("file://")) {
		return fileUrl;
	}

	try {
		const url = new URL(fileUrl);
		const pathname = decodeURIComponent(url.pathname);

		if (url.host && url.host !== "localhost") {
			return `//${url.host}${pathname}`;
		}

		if (/^\/[a-zA-Z]:/.test(pathname)) {
			return pathname.slice(1);
		}

		return pathname;
	} catch {
		const fallbackPath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ""));
		return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
	}
}

export function deriveNextId(prefix: string, ids: string[]): number {
	const max = ids.reduce((acc, id) => {
		const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
		if (!match) return acc;
		const value = Number(match[1]);
		return Number.isFinite(value) ? Math.max(acc, value) : acc;
	}, 0);
	return max + 1;
}

export function validateProjectData(candidate: unknown): candidate is EditorProjectData {
	if (!candidate || typeof candidate !== "object") return false;
	const project = candidate as Partial<EditorProjectData>;
	if (typeof project.version !== "number") return false;
	if (!resolveProjectMedia(project)) return false;
	if (!project.editor || typeof project.editor !== "object") return false;
	return true;
}

export function resolveProjectMedia(
	candidate: Partial<EditorProjectData> | { media?: unknown; videoPath?: unknown },
): ProjectMedia | null {
	const media = normalizeProjectMedia(candidate.media);
	if (media) {
		return media;
	}

	if (typeof candidate.videoPath === "string" && candidate.videoPath.trim()) {
		return { screenVideoPath: candidate.videoPath };
	}

	return null;
}

export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
	const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
	const normalizedAspectRatio: AspectRatio = validAspectRatios.has(
		editor.aspectRatio as AspectRatio,
	)
		? (editor.aspectRatio as AspectRatio)
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio;
	const normalizedWebcamLayoutPreset = computeNormalizedWebcamLayoutPreset(
		editor.webcamLayoutPreset,
		normalizedAspectRatio,
	);
	const normalizedWebcamPosition: WebcamPosition | null =
		normalizedWebcamLayoutPreset === "picture-in-picture" &&
		editor.webcamPosition &&
		typeof editor.webcamPosition === "object" &&
		isFiniteNumber((editor.webcamPosition as WebcamPosition).cx) &&
		isFiniteNumber((editor.webcamPosition as WebcamPosition).cy)
			? {
					cx: clamp((editor.webcamPosition as WebcamPosition).cx, 0, 1),
					cy: clamp((editor.webcamPosition as WebcamPosition).cy, 0, 1),
				}
			: DEFAULT_WEBCAM_SETTINGS.position;
	const normalizedVideoPosition: VideoPosition | null =
		editor.videoPosition &&
		typeof editor.videoPosition === "object" &&
		isFiniteNumber((editor.videoPosition as VideoPosition).cx) &&
		isFiniteNumber((editor.videoPosition as VideoPosition).cy)
			? {
					cx: clamp((editor.videoPosition as VideoPosition).cx, 0, 1),
					cy: clamp((editor.videoPosition as VideoPosition).cy, 0, 1),
				}
			: DEFAULT_VIDEO_POSITION;
	const normalizedVideoTransformKeyframes: VideoTransformKeyframe[] = Array.isArray(
		editor.videoTransformKeyframes,
	)
		? editor.videoTransformKeyframes
				.filter((keyframe): keyframe is VideoTransformKeyframe =>
					Boolean(
						keyframe &&
							typeof keyframe.id === "string" &&
							isFiniteNumber(keyframe.timeMs) &&
							isFiniteNumber(keyframe.scale),
					),
				)
				.map((keyframe) => ({
					id: keyframe.id,
					timeMs: Math.max(0, Math.round(keyframe.timeMs)),
					position:
						keyframe.position &&
						isFiniteNumber(keyframe.position.cx) &&
						isFiniteNumber(keyframe.position.cy)
							? {
									cx: clamp(keyframe.position.cx, 0, 1),
									cy: clamp(keyframe.position.cy, 0, 1),
								}
							: null,
					scale: clamp(keyframe.scale, MIN_VIDEO_SCALE, MAX_VIDEO_SCALE),
				}))
				.sort((left, right) => left.timeMs - right.timeMs)
				.filter(
					(keyframe, index, keyframes) =>
						index === keyframes.length - 1 || keyframe.timeMs !== keyframes[index + 1].timeMs,
				)
		: [];

	const normalizedZoomRegions: ZoomRegion[] = Array.isArray(editor.zoomRegions)
		? editor.zoomRegions
				.filter((region): region is ZoomRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					const validPreset =
						region.rotationPreset === "iso" ||
						region.rotationPreset === "left" ||
						region.rotationPreset === "right"
							? region.rotationPreset
							: undefined;
					return {
						id: region.id,
						startMs,
						endMs,
						depth: [1, 2, 3, 4, 5, 6].includes(region.depth) ? region.depth : DEFAULT_ZOOM_DEPTH,
						focus: {
							cx: clamp(isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5, 0, 1),
							cy: clamp(isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5, 0, 1),
						},
						focusMode: region.focusMode === "auto" ? "auto" : "manual",
						source: region.source === "auto" ? "auto" : "manual",
						...(validPreset ? { rotationPreset: validPreset } : {}),
					};
				})
		: [];

	const normalizedTrimRegions: TrimRegion[] = Array.isArray(editor.trimRegions)
		? editor.trimRegions
				.filter((region): region is TrimRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					return {
						id: region.id,
						startMs,
						endMs,
					};
				})
		: [];

	const normalizedSpeedRegions: SpeedRegion[] = Array.isArray(editor.speedRegions)
		? editor.speedRegions
				.filter((region): region is SpeedRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					const speed =
						isFiniteNumber(region.speed) &&
						region.speed >= MIN_PLAYBACK_SPEED &&
						region.speed <= MAX_PLAYBACK_SPEED
							? clampPlaybackSpeed(region.speed)
							: DEFAULT_PLAYBACK_SPEED;

					return {
						id: region.id,
						startMs,
						endMs,
						speed,
						guideRecordingId:
							typeof region.guideRecordingId === "string" ? region.guideRecordingId : undefined,
						guideNodeId: typeof region.guideNodeId === "string" ? region.guideNodeId : undefined,
					};
				})
		: [];

	const normalizedAudioRegions: AudioRegion[] = Array.isArray(editor.audioRegions)
		? editor.audioRegions
				.filter((region): region is AudioRegion =>
					Boolean(
						region &&
							typeof region.id === "string" &&
							typeof region.sourcePath === "string" &&
							region.sourcePath.length > 0,
					),
				)
				.map((region) =>
					normalizeMediaClipTiming(
						{
							id: region.id,
							startMs: isFiniteNumber(region.startMs) ? Math.max(0, Math.round(region.startMs)) : 0,
							endMs: isFiniteNumber(region.endMs)
								? Math.max(
										(isFiniteNumber(region.startMs) ? Math.max(0, Math.round(region.startMs)) : 0) +
											1,
										Math.round(region.endMs),
									)
								: (isFiniteNumber(region.startMs) ? Math.max(0, Math.round(region.startMs)) : 0) +
									1,
							sourcePath: region.sourcePath,
							name:
								typeof region.name === "string" && region.name.trim().length > 0
									? region.name
									: region.sourcePath.split(/[\\/]/).pop() || "Audio",
							sourceStartMs: region.sourceStartMs,
							fadeInMs: region.fadeInMs,
							fadeOutMs: region.fadeOutMs,
							volume: isFiniteNumber(region.volume) ? clamp(region.volume, 0, 2) : 1,
							...(isFiniteNumber(region.sourceDurationMs)
								? { sourceDurationMs: Math.max(0, region.sourceDurationMs) }
								: {}),
						},
						true,
					),
				)
		: [];

	const normalizedVideoRegions: VideoRegion[] = Array.isArray(editor.videoRegions)
		? editor.videoRegions
				.filter((region): region is VideoRegion =>
					Boolean(
						region &&
							typeof region.id === "string" &&
							typeof region.sourcePath === "string" &&
							region.sourcePath.trim().length > 0,
					),
				)
				.map((region, index) => {
					const startMs = isFiniteNumber(region.startMs)
						? Math.max(0, Math.round(region.startMs))
						: 0;
					const endMs = isFiniteNumber(region.endMs)
						? Math.max(startMs + 1, Math.round(region.endMs))
						: startMs + 1;
					return normalizeMediaClipTiming<VideoRegion>(
						{
							id: region.id,
							startMs,
							sourceStartMs: region.sourceStartMs,
							fadeInMs: region.fadeInMs,
							fadeOutMs: region.fadeOutMs,
							...(isFiniteNumber(region.volume) ? { volume: clamp(region.volume, 0, 1) } : {}),
							endMs,
							sourcePath: region.sourcePath,
							name:
								typeof region.name === "string" && region.name.trim()
									? region.name
									: region.sourcePath.split(/[\\/]/).pop() || "Video",
							sourceDurationMs: isFiniteNumber(region.sourceDurationMs)
								? Math.max(1, Math.round(region.sourceDurationMs))
								: Math.max(1, endMs - startMs),
							...(isFiniteNumber(region.sourceWidth) && region.sourceWidth > 0
								? { sourceWidth: Math.round(region.sourceWidth) }
								: {}),
							...(isFiniteNumber(region.sourceHeight) && region.sourceHeight > 0
								? { sourceHeight: Math.round(region.sourceHeight) }
								: {}),
							position: {
								x: clamp(isFiniteNumber(region.position?.x) ? region.position.x : 10, 0, 100),
								y: clamp(isFiniteNumber(region.position?.y) ? region.position.y : 10, 0, 100),
							},
							size: {
								width: clamp(isFiniteNumber(region.size?.width) ? region.size.width : 36, 5, 100),
								height: clamp(
									isFiniteNumber(region.size?.height) ? region.size.height : 30,
									5,
									100,
								),
							},
							fitMode: region.fitMode === "contain" ? "contain" : "cover",
							frameAspectRatio: VALID_VIDEO_REGION_ASPECT_RATIOS.has(
								region.frameAspectRatio as VideoRegionAspectRatio,
							)
								? region.frameAspectRatio
								: "source",
							cropPosition: {
								x: clamp(
									isFiniteNumber(region.cropPosition?.x) ? region.cropPosition.x : 50,
									0,
									100,
								),
								y: clamp(
									isFiniteNumber(region.cropPosition?.y) ? region.cropPosition.y : 50,
									0,
									100,
								),
							},
							cropZoom: clamp(isFiniteNumber(region.cropZoom) ? region.cropZoom : 1, 1, 4),
							zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
						},
						true,
					);
				})
		: [];

	const normalizedBlankSlideRegions: BlankSlideRegion[] = Array.isArray(editor.blankSlideRegions)
		? editor.blankSlideRegions
				.filter((region): region is BlankSlideRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const startMs = isFiniteNumber(region.startMs)
						? Math.max(0, Math.round(region.startMs))
						: 0;
					const normalized: BlankSlideRegion = {
						id: region.id,
						startMs,
						endMs: isFiniteNumber(region.endMs)
							? Math.max(startMs + 1, Math.round(region.endMs))
							: startMs + 1,
					};
					if (typeof region.backgroundColor === "string" && region.backgroundColor.trim()) {
						normalized.backgroundColor = region.backgroundColor;
					}
					if (isSlideTransitionType(region.transitionIn)) {
						normalized.transitionIn = region.transitionIn;
					}
					if (isSlideTransitionType(region.transitionOut)) {
						normalized.transitionOut = region.transitionOut;
					}
					if (isFiniteNumber(region.transitionDurationMs)) {
						normalized.transitionDurationMs = clamp(
							Math.round(region.transitionDurationMs),
							0,
							MAX_SLIDE_TRANSITION_DURATION_MS,
						);
					}
					return normalized;
				})
		: [];

	const normalizedAnnotationRegions: AnnotationRegion[] = Array.isArray(editor.annotationRegions)
		? editor.annotationRegions
				.filter((region): region is AnnotationRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region, index) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					const blurShape =
						typeof region.blurData?.shape === "string" &&
						VALID_BLUR_SHAPES.has(region.blurData.shape)
							? region.blurData.shape
							: DEFAULT_BLUR_DATA.shape;
					const blurType = normalizeBlurType(region.blurData?.type);
					const blurColor = normalizeBlurColor(region.blurData?.color);
					const rawType = region.type as string;
					const normalizedType: AnnotationRegion["type"] =
						rawType === "image" ||
						rawType === "figure" ||
						rawType === "rectangle" ||
						rawType === "pen" ||
						rawType === "redact" ||
						rawType === "blur"
							? rawType
							: rawType === "magnifier"
								? "rectangle"
								: "text";
					const normalizedWidth =
						rawType === "magnifier"
							? 24
							: clamp(
									isFiniteNumber(region.size?.width)
										? region.size.width
										: DEFAULT_ANNOTATION_SIZE.width,
									1,
									200,
								);
					const normalizedHeight =
						rawType === "magnifier"
							? 18
							: clamp(
									isFiniteNumber(region.size?.height)
										? region.size.height
										: DEFAULT_ANNOTATION_SIZE.height,
									1,
									200,
								);
					const legacyTargetX = region.magnifierData?.target?.x;
					const legacyTargetY = region.magnifierData?.target?.y;

					return {
						id: region.id,
						startMs,
						endMs,
						type: normalizedType,
						lane: normalizeLane(region.lane),
						content: typeof region.content === "string" ? region.content : "",
						textContent: typeof region.textContent === "string" ? region.textContent : undefined,
						imageContent: typeof region.imageContent === "string" ? region.imageContent : undefined,
						annotationSource:
							region.annotationSource === "auto-caption" ? ("auto-caption" as const) : undefined,
						position: {
							x:
								rawType === "magnifier" && isFiniteNumber(legacyTargetX)
									? clamp(legacyTargetX - normalizedWidth / 2, 0, 100 - normalizedWidth)
									: clamp(
											isFiniteNumber(region.position?.x)
												? region.position.x
												: DEFAULT_ANNOTATION_POSITION.x,
											0,
											100,
										),
							y:
								rawType === "magnifier" && isFiniteNumber(legacyTargetY)
									? clamp(legacyTargetY - normalizedHeight / 2, 0, 100 - normalizedHeight)
									: clamp(
											isFiniteNumber(region.position?.y)
												? region.position.y
												: DEFAULT_ANNOTATION_POSITION.y,
											0,
											100,
										),
						},
						size: {
							width: normalizedWidth,
							height: normalizedHeight,
						},
						rotation: isFiniteNumber(region.rotation) ? ((region.rotation % 360) + 360) % 360 : 0,
						style: {
							...DEFAULT_ANNOTATION_STYLE,
							...(region.style && typeof region.style === "object" ? region.style : {}),
							textAnimation: normalizeTextAnimation(region.style?.textAnimation),
						},
						zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
						guideRecordingId:
							typeof region.guideRecordingId === "string" ? region.guideRecordingId : undefined,
						guideNodeId: typeof region.guideNodeId === "string" ? region.guideNodeId : undefined,
						guideRole:
							region.guideRole === "rectangle" ||
							region.guideRole === "arrow" ||
							region.guideRole === "text"
								? region.guideRole
								: undefined,
						figureData: region.figureData
							? {
									...(normalizedType === "rectangle"
										? DEFAULT_RECTANGLE_FIGURE_DATA
										: DEFAULT_FIGURE_DATA),
									...region.figureData,
									...(normalizedType === "rectangle"
										? {
												spotlightZoom: isFiniteNumber(region.figureData.spotlightZoom)
													? clamp(
															region.figureData.spotlightZoom,
															MIN_RECTANGLE_SPOTLIGHT_ZOOM,
															MAX_RECTANGLE_SPOTLIGHT_ZOOM,
														)
													: DEFAULT_RECTANGLE_SPOTLIGHT_ZOOM,
											}
										: {}),
								}
							: undefined,
						penData:
							region.penData && typeof region.penData === "object"
								? {
										color:
											typeof region.penData.color === "string"
												? region.penData.color
												: DEFAULT_PEN_DATA.color,
										strokeWidth: isFiniteNumber(region.penData.strokeWidth)
											? clamp(region.penData.strokeWidth, 1, 32)
											: DEFAULT_PEN_DATA.strokeWidth,
										strokes: Array.isArray(region.penData.strokes)
											? region.penData.strokes.map((stroke) =>
													Array.isArray(stroke)
														? stroke
																.filter((point): point is { x: number; y: number } =>
																	Boolean(
																		point &&
																			isFiniteNumber((point as { x?: unknown }).x) &&
																			isFiniteNumber((point as { y?: unknown }).y),
																	),
																)
																.map((point) => ({
																	x: clamp(point.x, 0, 100),
																	y: clamp(point.y, 0, 100),
																}))
														: [],
												)
											: [],
									}
								: normalizedType === "pen"
									? { ...DEFAULT_PEN_DATA, strokes: [] }
									: undefined,
						blurData:
							region.blurData && typeof region.blurData === "object"
								? {
										...DEFAULT_BLUR_DATA,
										...region.blurData,
										type: blurType,
										shape: blurShape,
										color: blurColor,
										intensity: isFiniteNumber(region.blurData.intensity)
											? clamp(region.blurData.intensity, MIN_BLUR_INTENSITY, MAX_BLUR_INTENSITY)
											: DEFAULT_BLUR_INTENSITY,
										blockSize: isFiniteNumber(region.blurData.blockSize)
											? clamp(region.blurData.blockSize, MIN_BLUR_BLOCK_SIZE, MAX_BLUR_BLOCK_SIZE)
											: DEFAULT_BLUR_BLOCK_SIZE,
										freehandPoints: Array.isArray(region.blurData.freehandPoints)
											? region.blurData.freehandPoints
													.filter(
														(
															point,
														): point is {
															x: number;
															y: number;
														} =>
															Boolean(
																point &&
																	isFiniteNumber((point as { x?: unknown }).x) &&
																	isFiniteNumber((point as { y?: unknown }).y),
															),
													)
													.map((point) => ({
														x: clamp(point.x, 0, 100),
														y: clamp(point.y, 0, 100),
													}))
											: DEFAULT_BLUR_FREEHAND_POINTS,
									}
								: undefined,
					};
				})
		: [];

	const rawCropX = isFiniteNumber(editor.cropRegion?.x)
		? editor.cropRegion.x
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.x;
	const rawCropY = isFiniteNumber(editor.cropRegion?.y)
		? editor.cropRegion.y
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.y;
	const rawCropWidth = isFiniteNumber(editor.cropRegion?.width)
		? editor.cropRegion.width
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.width;
	const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
		? editor.cropRegion.height
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.height;

	const cropX = clamp(rawCropX, 0, 1);
	const cropY = clamp(rawCropY, 0, 1);
	const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);
	const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);

	return {
		cursorTheme: normalizeCursorThemeId(editor.cursorTheme),
		wallpaper:
			typeof editor.wallpaper === "string"
				? normalizeWallpaperValue(editor.wallpaper)
				: DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper,
		shadowIntensity:
			typeof editor.shadowIntensity === "number"
				? editor.shadowIntensity
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.shadowIntensity,
		showBlur:
			typeof editor.showBlur === "boolean"
				? editor.showBlur
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.showBlur,
		showTrimWaveform:
			typeof editor.showTrimWaveform === "boolean"
				? editor.showTrimWaveform
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.showTrimWaveform,
		motionBlurAmount: isFiniteNumber(editor.motionBlurAmount)
			? clamp(editor.motionBlurAmount, 0, 1)
			: typeof (editor as { motionBlurEnabled?: unknown }).motionBlurEnabled === "boolean"
				? (editor as { motionBlurEnabled?: boolean }).motionBlurEnabled
					? DEFAULT_ZOOM_MOTION_BLUR
					: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount,
		borderRadius:
			typeof editor.borderRadius === "number"
				? editor.borderRadius
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.borderRadius,
		padding: isFiniteNumber(editor.padding)
			? clamp(editor.padding, 0, 100)
			: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
		videoPosition: normalizedVideoPosition,
		videoScale: isFiniteNumber(editor.videoScale)
			? clamp(editor.videoScale, MIN_VIDEO_SCALE, MAX_VIDEO_SCALE)
			: DEFAULT_VIDEO_SCALE,
		videoTransformKeyframes: normalizedVideoTransformKeyframes,
		cropRegion: {
			x: cropX,
			y: cropY,
			width: cropWidth,
			height: cropHeight,
		},
		zoomRegions: normalizedZoomRegions,
		// Default on for legacy projects so re-opens match the new default. The
		// on-load auto-suggest pass is gated separately, so this won't add zooms.
		autoZoomEnabled: typeof editor.autoZoomEnabled === "boolean" ? editor.autoZoomEnabled : true,
		autoFocusAll: typeof editor.autoFocusAll === "boolean" ? editor.autoFocusAll : false,
		trimRegions: normalizedTrimRegions,
		speedRegions: normalizedSpeedRegions,
		annotationRegions: normalizedAnnotationRegions,
		audioRegions: normalizedAudioRegions,
		videoRegions: normalizedVideoRegions,
		blankSlideRegions: normalizedBlankSlideRegions,
		aspectRatio: normalizedAspectRatio,
		webcamLayoutPreset: normalizedWebcamLayoutPreset,
		webcamMaskShape:
			editor.webcamMaskShape === "rectangle" ||
			editor.webcamMaskShape === "circle" ||
			editor.webcamMaskShape === "square" ||
			editor.webcamMaskShape === "rounded"
				? editor.webcamMaskShape
				: DEFAULT_WEBCAM_SETTINGS.maskShape,
		webcamMirrored:
			typeof editor.webcamMirrored === "boolean" ? editor.webcamMirrored : DEFAULT_WEBCAM_MIRRORED,
		webcamReactiveZoom:
			typeof editor.webcamReactiveZoom === "boolean"
				? editor.webcamReactiveZoom
				: DEFAULT_WEBCAM_REACTIVE_ZOOM,
		webcamSizePreset:
			typeof editor.webcamSizePreset === "number" && isFiniteNumber(editor.webcamSizePreset)
				? Math.max(10, Math.min(50, editor.webcamSizePreset))
				: DEFAULT_WEBCAM_SETTINGS.sizePreset,
		webcamPosition: normalizedWebcamPosition,
		exportQuality:
			editor.exportQuality === "source"
				? "ultra"
				: editor.exportQuality === "medium" ||
						editor.exportQuality === "good" ||
						editor.exportQuality === "ultra"
					? editor.exportQuality
					: DEFAULT_EXPORT_SETTINGS.quality,
		exportFormat: editor.exportFormat === "gif" ? "gif" : DEFAULT_EXPORT_SETTINGS.format,
		gifFrameRate:
			editor.gifFrameRate === 15 ||
			editor.gifFrameRate === 20 ||
			editor.gifFrameRate === 25 ||
			editor.gifFrameRate === 30
				? editor.gifFrameRate
				: DEFAULT_GIF_SETTINGS.frameRate,
		gifLoop: typeof editor.gifLoop === "boolean" ? editor.gifLoop : DEFAULT_GIF_SETTINGS.loop,
		gifSizePreset:
			editor.gifSizePreset === "medium" ||
			editor.gifSizePreset === "large" ||
			editor.gifSizePreset === "original"
				? editor.gifSizePreset
				: DEFAULT_GIF_SETTINGS.sizePreset,
	};
}

export function createProjectData(
	media: ProjectMedia,
	editor: ProjectEditorState,
): EditorProjectData {
	return {
		version: PROJECT_VERSION,
		media,
		editor,
	};
}

export function createProjectSnapshot(
	media: ProjectMedia,
	editor: Partial<ProjectEditorState>,
): string {
	return JSON.stringify(createProjectData(media, normalizeProjectEditor(editor)));
}

export function hasProjectUnsavedChanges(
	currentSnapshot: string | null,
	baselineSnapshot: string | null,
): boolean {
	return Boolean(
		currentSnapshot !== null && baselineSnapshot !== null && currentSnapshot !== baselineSnapshot,
	);
}
