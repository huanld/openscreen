import {
	Application,
	BlurFilter,
	Container,
	Graphics,
	Rectangle,
	Sprite,
	Texture,
	VideoSource,
} from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { CanvasSnapGuides } from "@/components/editor/CanvasSnapGuides";
import {
	getRectangleSpotlightGeometry,
	getRectangleSpotlightSourceResolution,
	getRectangleSpotlightZoom,
	hasActiveRectangleSpotlight,
	RECTANGLE_SPOTLIGHT_DIM_COLOR,
} from "@/lib/annotationSpotlight";
import { isCanvasAnchoredAnnotation, mapAnnotationToViewport } from "@/lib/annotationViewport";
import { resolveBlankSlidePresentation } from "@/lib/blankSlides";
import {
	CANVAS_SNAP_DISTANCE,
	type CanvasDragSnap,
	type CanvasSnapGuide,
	snapCanvasRect,
} from "@/lib/canvasSnapping";
import {
	getWebcamLayoutCssBoxShadow,
	type RenderRect,
	reactiveWebcamScale,
	type Size,
	type StyledRenderRect,
	type WebcamLayoutPreset,
	type WebcamSizePreset,
} from "@/lib/compositeLayout";
import {
	CURSOR_HIGHLIGHT_BORDER,
	CURSOR_HIGHLIGHT_FILL,
	getCursorHighlightBorderWidth,
	getCursorHighlightDiameter,
} from "@/lib/cursor/cursorHighlight";
import { getSmoothedCursorPath } from "@/lib/cursor/cursorPathSmoothing";
import {
	createNativeCursorMotionBlurState,
	getNativeCursorClickBounceProgress,
	getNativeCursorClickBounceScale,
	getNativeCursorMotionBlurPx,
	hasNativeCursorRecordingData,
	projectNativeCursorToLocal,
	projectNativeCursorToStage,
	resetNativeCursorMotionBlurState,
	resolveInterpolatedNativeCursorFrame,
	resolveNativeCursorRenderAsset,
} from "@/lib/cursor/nativeCursor";
import { timelineToSourceMs } from "@/lib/insertedSlideTiming";
import { slideAwareCursorTelemetry } from "@/lib/slideAwareCursor";
import { clipTimelineView } from "@/lib/slideAwareMediaClip";
import { getVideoCanvasSnapTargets } from "@/lib/videoCanvasSnapping";
import { classifyWallpaper, DEFAULT_WALLPAPER, resolveImageWallpaperUrl } from "@/lib/wallpaper";
import { getCssClipPath } from "@/lib/webcamMaskShapes";
import type { CursorRecordingData } from "@/native/contracts";
import {
	type AspectRatio,
	formatAspectRatioForCSS,
	getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { getTimelinePlaybackRate } from "./audioTrack";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import {
	type AnnotationRegion,
	type BlankSlideRegion,
	type BlurData,
	type CursorTelemetryPoint,
	computeRotation3DContainScale,
	DEFAULT_ROTATION_3D,
	type FigureData,
	getZoomScale,
	isRotation3DIdentity,
	lerpRotation3D,
	MAX_VIDEO_SCALE,
	MIN_VIDEO_SCALE,
	type PenData,
	rotation3DPerspective,
	type SpeedRegion,
	type TrimRegion,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
import { type PreviewVideoRegion, VideoComponentOverlay } from "./VideoComponentOverlay";
import { AUTO_FOLLOW_PARAMS, DEFAULT_FOCUS } from "./videoPlayback/constants";
import { advanceFollowFocus } from "./videoPlayback/cursorFollowUtils";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "./videoPlayback/cursorRenderer";
import { clampFocusToScale } from "./videoPlayback/focusUtils";
import { createInsertedSlidePlayback } from "./videoPlayback/insertedSlidePlayback";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { clamp01 } from "./videoPlayback/mathUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { createZoomSpringState, resetZoomSpring, stepZoomSpring } from "./videoPlayback/zoomSpring";
import {
	applyZoomTransform,
	computeFocusFromTransform,
	computeZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "./videoPlayback/zoomTransform";

interface VideoPlaybackProps {
	videoPath: string;
	webcamVideoPath?: string;
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamMaskShape?: import("./types").WebcamMaskShape;
	webcamMirrored?: boolean;
	webcamReactiveZoom?: boolean;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	onWebcamPositionChange?: (position: { cx: number; cy: number }) => void;
	onWebcamPositionDragEnd?: () => void;
	videoPosition?: { cx: number; cy: number } | null;
	onVideoPositionChange?: (position: { cx: number; cy: number }) => void;
	onVideoPositionDragEnd?: () => void;
	videoScale?: number;
	onVideoScaleChange?: (scale: number) => void;
	onVideoScaleDragEnd?: () => void;
	onDurationChange: (duration: number) => void;
	onTimeUpdate: (time: number) => void;
	currentTime: number;
	onPlayStateChange: (playing: boolean) => void;
	onError: (error: string) => void;
	wallpaper?: string;
	zoomRegions: ZoomRegion[];
	blankSlideRegions?: BlankSlideRegion[];
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	onZoomFocusDragEnd?: () => void;
	isPlaying: boolean;
	showShadow?: boolean;
	shadowIntensity?: number;
	showBlur?: boolean;
	motionBlurAmount?: number;
	borderRadius?: number;
	padding?: number;
	cropRegion?: import("./types").CropRegion;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	aspectRatio: AspectRatio;
	cursorRecordingData?: CursorRecordingData | null;
	annotationRegions?: AnnotationRegion[];
	videoRegions?: PreviewVideoRegion[];
	selectedVideoRegionId?: string | null;
	onSelectVideoRegion?: (id: string | null) => void;
	onVideoRegionGeometryChange?: (
		id: string,
		patch: Partial<Pick<import("./types").VideoRegion, "position" | "size">>,
	) => void;
	onVideoRegionDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
	onAnnotationRotationChange?: (id: string, rotation: number) => void;
	onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
	onAnnotationFigureDataCommit?: () => void;
	blurRegions?: AnnotationRegion[];
	selectedBlurId?: string | null;
	onSelectBlur?: (id: string | null) => void;
	onBlurPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onBlurSizeChange?: (id: string, size: { width: number; height: number }) => void;
	onBlurDataChange?: (id: string, blurData: BlurData) => void;
	onBlurDataCommit?: () => void;
	onPenDataChange?: (id: string, penData: PenData) => void;
	onPenDataCommit?: () => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorClickTimestamps?: number[];
	showCursor?: boolean;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClipToBounds?: boolean;
	cursorTheme?: string;
	cursorHighlight?: boolean;
	cursorHighlightSize?: number;
	// Render the selected zoom at the playhead even while paused, so the editor can
	// preview the effect without leaving the focus-edit view.
	isPreviewingZoom?: boolean;
}

export interface VideoPlaybackRef {
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement>;
	play: () => Promise<void>;
	pause: () => void;
	seek: (seconds: number) => void;
}

function getResolvedVideoDuration(video: HTMLVideoElement): number | null {
	if (Number.isFinite(video.duration) && video.duration > 0) {
		return video.duration;
	}

	if (video.seekable.length > 0) {
		const lastRangeIndex = video.seekable.length - 1;
		const seekableEnd = video.seekable.end(lastRangeIndex);
		if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
			return seekableEnd;
		}
	}

	return null;
}

function getEndedVideoDuration(video: HTMLVideoElement): number | null {
	const currentTime = video.currentTime;
	if (!Number.isFinite(currentTime) || currentTime <= 0) {
		return null;
	}

	if (video.ended) {
		return currentTime;
	}

	const resolvedDuration = getResolvedVideoDuration(video);
	const durationEpsilonSeconds = 0.05;
	if (resolvedDuration && currentTime >= resolvedDuration - durationEpsilonSeconds) {
		return resolvedDuration;
	}

	return null;
}

type AudioTrackListLike = {
	length: number;
	[index: number]: { enabled: boolean };
};

type VideoElementWithAudioTracks = HTMLVideoElement & {
	audioTracks?: AudioTrackListLike;
};

function enableAllPreviewAudioTracks(video: HTMLVideoElement) {
	const audioTracks = (video as VideoElementWithAudioTracks).audioTracks;
	if (!audioTracks || audioTracks.length <= 1) {
		return;
	}

	for (let index = 0; index < audioTracks.length; index += 1) {
		audioTracks[index].enabled = true;
	}
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(
	(
		{
			videoPath,
			webcamVideoPath,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored = false,
			webcamReactiveZoom = false,
			webcamSizePreset,
			webcamPosition,
			onWebcamPositionChange,
			onWebcamPositionDragEnd,
			videoPosition,
			onVideoPositionChange,
			onVideoPositionDragEnd,
			videoScale = 1,
			onVideoScaleChange,
			onVideoScaleDragEnd,
			onDurationChange,
			onTimeUpdate,
			currentTime,
			onPlayStateChange,
			onError,
			wallpaper,
			zoomRegions,
			blankSlideRegions = [],
			selectedZoomId,
			onSelectZoom,
			onZoomFocusChange,
			onZoomFocusDragEnd,
			isPlaying,
			showShadow,
			shadowIntensity = 0,
			showBlur,
			motionBlurAmount = 0,
			borderRadius = 0,
			padding = DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
			cropRegion,
			trimRegions = [],
			speedRegions = [],
			aspectRatio,
			cursorRecordingData,
			annotationRegions = [],
			videoRegions = [],
			selectedVideoRegionId,
			onSelectVideoRegion,
			onVideoRegionGeometryChange,
			onVideoRegionDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			onAnnotationPositionChange,
			onAnnotationSizeChange,
			onAnnotationRotationChange,
			onAnnotationFigureDataChange,
			onAnnotationFigureDataCommit,
			blurRegions = [],
			selectedBlurId,
			onSelectBlur,
			onBlurPositionChange,
			onBlurSizeChange,
			onBlurDataChange,
			onBlurDataCommit,
			onPenDataChange,
			onPenDataCommit,
			cursorTelemetry = [],
			cursorClickTimestamps = [],
			showCursor = false,
			cursorSize = DEFAULT_CURSOR_SETTINGS.size,
			cursorSmoothing = DEFAULT_CURSOR_SETTINGS.smoothing,
			cursorMotionBlur = DEFAULT_CURSOR_SETTINGS.motionBlur,
			cursorClickBounce = DEFAULT_CURSOR_SETTINGS.clickBounce,
			cursorClipToBounds = DEFAULT_CURSOR_SETTINGS.clipToBounds,
			cursorTheme = DEFAULT_CURSOR_SETTINGS.theme,
			cursorHighlight = DEFAULT_CURSOR_SETTINGS.highlight,
			cursorHighlightSize = DEFAULT_CURSOR_SETTINGS.highlightSize,
			isPreviewingZoom = false,
		},
		ref,
	) => {
		const spotlightMaskId = useId().replace(/:/g, "");
		const videoRef = useRef<HTMLVideoElement | null>(null);
		const supplementalAudioRef = useRef<HTMLAudioElement | null>(null);
		const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
		const webcamWrapperRef = useRef<HTMLDivElement | null>(null);
		const webcamReactiveZoomRef = useRef(webcamReactiveZoom);
		const webcamLayoutPresetRef = useRef(webcamLayoutPreset);
		const webcamPositionRef = useRef(webcamPosition);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const appRef = useRef<Application | null>(null);
		const videoSpriteRef = useRef<Sprite | null>(null);
		const videoContainerRef = useRef<Container | null>(null);
		const cameraContainerRef = useRef<Container | null>(null);
		const timeUpdateAnimationRef = useRef<number | null>(null);
		const [pixiReady, setPixiReady] = useState(false);
		const [videoReady, setVideoReady] = useState(false);
		const [supplementalAudioPath, setSupplementalAudioPath] = useState<string | null>(null);
		const [overlaySize, setOverlaySize] = useState({ width: 800, height: 600 });
		const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
		const overlayRef = useRef<HTMLDivElement | null>(null);

		const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
		const composite3DRef = useRef<HTMLDivElement | null>(null);
		const outerWrapperRef = useRef<HTMLDivElement | null>(null);
		const [webcamLayout, setWebcamLayout] = useState<StyledRenderRect | null>(null);
		const [mainVideoLayout, setMainVideoLayout] = useState<RenderRect | null>(null);
		const [isMainVideoSelected, setIsMainVideoSelected] = useState(false);
		const blankSlidePresentation = resolveBlankSlidePresentation(
			blankSlideRegions,
			Math.round(currentTime * 1000),
		);
		const isBlankSlide = blankSlidePresentation !== null;
		const [snapGuides, setSnapGuides] = useState<CanvasSnapGuide[]>([]);
		const clearSnapGuides = useCallback(() => setSnapGuides([]), []);
		const snapTargets = useMemo(
			() =>
				getVideoCanvasSnapTargets({
					width: overlaySize.width,
					height: overlaySize.height,
					timeMs: Math.round(currentTime * 1000),
					isBlankSlide,
					mainVideo: mainVideoLayout,
					webcam: webcamVideoPath ? webcamLayout : null,
					annotations: annotationRegions,
					blurs: blurRegions,
					videos: videoRegions.map((region) => clipTimelineView(region, blankSlideRegions)),
					selectedAnnotationId,
					selectedBlurId,
					selectedVideoId: selectedVideoRegionId,
				}),
			[
				overlaySize,
				currentTime,
				isBlankSlide,
				mainVideoLayout,
				webcamVideoPath,
				webcamLayout,
				annotationRegions,
				blurRegions,
				videoRegions,
				blankSlideRegions,
				selectedAnnotationId,
				selectedBlurId,
				selectedVideoRegionId,
			],
		);
		const snapCanvasDrag = useCallback<CanvasDragSnap>(
			(rect, bypass, bounds) => {
				const displayWidth = overlayRef.current?.getBoundingClientRect().width;
				const result = snapCanvasRect({
					rect,
					frame: { x: 0, y: 0, ...overlaySize },
					targets: snapTargets,
					bounds,
					threshold: CANVAS_SNAP_DISTANCE * (displayWidth ? overlaySize.width / displayWidth : 1),
					disabled: bypass,
				});
				setSnapGuides(result.guides);
				return result;
			},
			[overlaySize, snapTargets],
		);
		useEffect(() => {
			void currentTime;
			void isPlaying;
			void overlaySize;
			clearSnapGuides();
		}, [currentTime, isPlaying, overlaySize, clearSnapGuides]);
		const slideTransform = blankSlidePresentation
			? `translate3d(${blankSlidePresentation.offsetX * 100}%, ${blankSlidePresentation.offsetY * 100}%, 0) scale(${blankSlidePresentation.scale})`
			: undefined;
		const [webcamDimensions, setWebcamDimensions] = useState<Size | null>(null);
		const currentTimeRef = useRef(0);
		const blankSlideRegionsRef = useRef(blankSlideRegions);
		blankSlideRegionsRef.current = blankSlideRegions;
		const timelinePlaybackRef = useRef<ReturnType<typeof createInsertedSlidePlayback> | null>(null);
		const sourceTime = timelineToSourceMs(currentTime * 1000, blankSlideRegions) / 1000;
		useEffect(() => {
			// Re-align a paused preview immediately when a slide is moved, resized or deleted.
			void blankSlideRegions;
			timelinePlaybackRef.current?.seek(currentTimeRef.current / 1000);
		}, [blankSlideRegions]);
		const zoomRegionsRef = useRef<ZoomRegion[]>([]);
		const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);
		const cursorClickTimestampsRef = useRef<number[]>([]);
		const selectedZoomIdRef = useRef<string | null>(null);
		const animationStateRef = useRef({
			scale: 1,
			focusX: DEFAULT_FOCUS.cx,
			focusY: DEFAULT_FOCUS.cy,
			progress: 0,
			x: 0,
			y: 0,
			appliedScale: 1,
		});
		// Spring that chases the eased zoom target so the camera glides instead of jerking.
		const zoomSpringRef = useRef(createZoomSpringState());
		const prevZoomTimeMsRef = useRef<number | null>(null);
		const blurFilterRef = useRef<BlurFilter | null>(null);
		const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
		const isDraggingFocusRef = useRef(false);
		const isDraggingWebcamRef = useRef(false);
		const isDraggingMainVideoRef = useRef(false);
		const mainVideoDragOffsetRef = useRef({ dx: 0, dy: 0 });
		const mainVideoResizeRef = useRef<{
			startX: number;
			startY: number;
			startScale: number;
			directionX: -1 | 1;
			directionY: -1 | 1;
		} | null>(null);
		const webcamDragOffsetRef = useRef({ dx: 0, dy: 0 });
		const stageSizeRef = useRef({ width: 0, height: 0 });
		const videoSizeRef = useRef({ width: 0, height: 0 });
		const baseScaleRef = useRef(1);
		const baseOffsetRef = useRef({ x: 0, y: 0 });
		const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
		const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
		const maskGraphicsRef = useRef<Graphics | null>(null);
		const isPlayingRef = useRef(isPlaying);
		const isSeekingRef = useRef(false);
		const isScrubbingRef = useRef(false);
		const scrubEndTimerRef = useRef<number | null>(null);
		const [isScrubbing, setIsScrubbing] = useState(false);
		const allowPlaybackRef = useRef(false);
		const lockedVideoDimensionsRef = useRef<{
			width: number;
			height: number;
		} | null>(null);
		const layoutVideoContentRef = useRef<(() => void) | null>(null);
		const trimRegionsRef = useRef<TrimRegion[]>([]);
		const speedRegionsRef = useRef<SpeedRegion[]>([]);
		const annotationRegionsRef = useRef<AnnotationRegion[]>(annotationRegions);
		const motionBlurAmountRef = useRef(motionBlurAmount);
		const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);
		const showCursorRef = useRef(showCursor);
		const cursorSizeRef = useRef(cursorSize);
		const cursorSmoothingRef = useRef(cursorSmoothing);
		const cursorMotionBlurRef = useRef(cursorMotionBlur);
		const cursorClickBounceRef = useRef(cursorClickBounce);
		const cursorClipToBoundsRef = useRef(cursorClipToBounds);
		const cursorThemeRef = useRef(cursorTheme);
		const cursorHighlightRef = useRef(cursorHighlight);
		const cursorHighlightSizeRef = useRef(cursorHighlightSize);
		const isPreviewingZoomRef = useRef(isPreviewingZoom);
		const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());
		const onTimeUpdateRef = useRef(onTimeUpdate);
		const onPlayStateChangeRef = useRef(onPlayStateChange);
		const videoReadyRafRef = useRef<number | null>(null);
		const smoothedAutoFocusRef = useRef<ZoomFocus | null>(null);
		const prevTargetProgressRef = useRef(0);
		const durationResolutionTimeoutRef = useRef<number | null>(null);
		const lastResolvedDurationRef = useRef<number | null>(null);
		const isResolvingDurationRef = useRef(false);
		const hasNativeCursorRecordingRef = useRef(false);
		const cursorRecordingDataRef = useRef(cursorRecordingData);
		const cropRegionRef = useRef(cropRegion);
		const nativeCursorSpriteRef = useRef<Sprite | null>(null);
		const nativeCursorTextureIdRef = useRef<string | null>(null);
		const nativeCursorImageRef = useRef<HTMLImageElement | null>(null);
		const nativeCursorHighlightRef = useRef<HTMLDivElement | null>(null);
		const nativeCursorImageIdRef = useRef<string | null>(null);
		const nativeCursorMotionBlurStateRef = useRef(createNativeCursorMotionBlurState());
		const nativeCursorClipRef = useRef<HTMLDivElement | null>(null);
		const borderRadiusRef = useRef<number>(0);

		const hasNativeCursorRecording = useMemo(
			() => hasNativeCursorRecordingData(cursorRecordingData),
			[cursorRecordingData],
		);

		const syncResolvedDuration = useCallback(
			(video: HTMLVideoElement) => {
				const resolvedDuration = getResolvedVideoDuration(video);
				if (!resolvedDuration) {
					return false;
				}

				const normalizedDuration = Math.round(resolvedDuration * 1000) / 1000;
				if (lastResolvedDurationRef.current !== normalizedDuration) {
					lastResolvedDurationRef.current = normalizedDuration;
					onDurationChange(normalizedDuration);
				}

				return true;
			},
			[onDurationChange],
		);

		const forceResolveDuration = useCallback(
			(video: HTMLVideoElement) => {
				if (isResolvingDurationRef.current) {
					return;
				}

				if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
					return;
				}

				isResolvingDurationRef.current = true;
				const previousMuted = video.muted;

				const finalize = () => {
					video.removeEventListener("durationchange", handleProgress);
					video.removeEventListener("timeupdate", handleProgress);
					video.removeEventListener("loadeddata", handleProgress);
					video.removeEventListener("ended", handleProgress);
					if (durationResolutionTimeoutRef.current) {
						clearTimeout(durationResolutionTimeoutRef.current);
						durationResolutionTimeoutRef.current = null;
					}
					video.muted = previousMuted;
					isResolvingDurationRef.current = false;
				};

				const resolveCurrentDuration = () => {
					if (syncResolvedDuration(video)) {
						return true;
					}

					const endedDuration = getEndedVideoDuration(video);
					if (endedDuration) {
						lastResolvedDurationRef.current = null;
						onDurationChange(Math.round(endedDuration * 1000) / 1000);
						return true;
					}

					return false;
				};

				const handleProgress = () => {
					if (!resolveCurrentDuration()) {
						return;
					}

					try {
						video.pause();
						video.currentTime = 0;
					} catch {
						// no-op
					}
					currentTimeRef.current = 0;
					finalize();
				};

				video.addEventListener("durationchange", handleProgress);
				video.addEventListener("timeupdate", handleProgress);
				video.addEventListener("loadeddata", handleProgress);
				video.addEventListener("ended", handleProgress);
				durationResolutionTimeoutRef.current = window.setTimeout(() => {
					handleProgress();
					finalize();
				}, 1500);
				video.muted = true;

				const playAttempt = video.play();
				if (playAttempt && typeof playAttempt.catch === "function") {
					playAttempt.catch(() => {
						try {
							video.currentTime = Math.max(video.currentTime, 0.1);
						} catch {
							finalize();
						}
					});
				}

				try {
					video.currentTime = Math.max(video.currentTime, 0.1);
				} catch {
					finalize();
				}
			},
			[onDurationChange, syncResolvedDuration],
		);

		// Clamp against getZoomScale(region), not region.depth: depth is just the preset
		// slot (1x/2x/4x) and ignores customScale, which gives wrong drag bounds near the edges.
		const clampFocusForRegion = useCallback((focus: ZoomFocus, region: ZoomRegion) => {
			return clampFocusToScale(focus, getZoomScale(region));
		}, []);

		const updateOverlayForRegion = useCallback(
			(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
				const overlayEl = overlayRef.current;
				const indicatorEl = focusIndicatorRef.current;

				if (!overlayEl || !indicatorEl) {
					return;
				}

				const stageWidth = overlayEl.clientWidth;
				const stageHeight = overlayEl.clientHeight;
				if (stageWidth && stageHeight) {
					stageSizeRef.current = { width: stageWidth, height: stageHeight };
				}

				updateOverlayIndicator({
					overlayEl,
					indicatorEl,
					region,
					focusOverride,
					videoSize: videoSizeRef.current,
					baseScale: baseScaleRef.current,
				});
			},
			[],
		);

		const layoutVideoContent = useCallback(() => {
			const container = containerRef.current;
			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const maskGraphics = maskGraphicsRef.current;
			const videoElement = videoRef.current;
			const cameraContainer = cameraContainerRef.current;

			if (
				!container ||
				!app ||
				!videoSprite ||
				!maskGraphics ||
				!videoElement ||
				!cameraContainer
			) {
				return;
			}

			// Lock video dimensions on first layout to prevent resize issues
			if (
				!lockedVideoDimensionsRef.current &&
				videoElement.videoWidth > 0 &&
				videoElement.videoHeight > 0
			) {
				lockedVideoDimensionsRef.current = {
					width: videoElement.videoWidth,
					height: videoElement.videoHeight,
				};
			}

			const result = layoutVideoContentUtil({
				container,
				app,
				videoSprite,
				maskGraphics,
				videoElement,
				cropRegion,
				lockedVideoDimensions: lockedVideoDimensionsRef.current,
				borderRadius,
				padding,
				webcamDimensions,
				webcamLayoutPreset,
				webcamSizePreset,
				webcamPosition,
				videoPosition,
				videoScale,
				webcamMaskShape,
			});

			if (result) {
				stageSizeRef.current = result.stageSize;
				videoSizeRef.current = result.videoSize;
				baseScaleRef.current = result.baseScale;
				baseOffsetRef.current = result.baseOffset;
				baseMaskRef.current = result.maskRect;
				borderRadiusRef.current = result.maskBorderRadius;
				cropBoundsRef.current = result.cropBounds;
				setWebcamLayout(result.webcamRect);
				setMainVideoLayout((previous) =>
					previous &&
					previous.x === result.maskRect.x &&
					previous.y === result.maskRect.y &&
					previous.width === result.maskRect.width &&
					previous.height === result.maskRect.height
						? previous
						: result.maskRect,
				);

				// Reset camera container to identity
				cameraContainer.scale.set(1);
				cameraContainer.position.set(0, 0);

				const selectedId = selectedZoomIdRef.current;
				const activeRegion = selectedId
					? (zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null)
					: null;

				updateOverlayForRegion(activeRegion);
			}
		}, [
			updateOverlayForRegion,
			cropRegion,
			borderRadius,
			padding,
			webcamDimensions,
			webcamLayoutPreset,
			webcamSizePreset,
			webcamPosition,
			videoPosition,
			videoScale,
			webcamMaskShape,
		]);

		useEffect(() => {
			layoutVideoContentRef.current = layoutVideoContent;
		}, [layoutVideoContent]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			layoutVideoContent();
		}, [layoutVideoContent, pixiReady, videoReady]);

		const setOverlayRefs = useCallback((node: HTMLDivElement | null) => {
			overlayRef.current = node;
			setOverlayElement(node);
		}, []);

		const selectedZoom = useMemo(() => {
			if (!selectedZoomId) return null;
			return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
		}, [zoomRegions, selectedZoomId]);

		useImperativeHandle(ref, () => ({
			video: videoRef.current,
			app: appRef.current,
			videoSprite: videoSpriteRef.current,
			videoContainer: videoContainerRef.current,
			containerRef,
			play: async () => {
				const vid = videoRef.current;
				if (!vid) return;
				if (timelinePlaybackRef.current) {
					enableAllPreviewAudioTracks(vid);
					await timelinePlaybackRef.current.play();
					return;
				}
				try {
					allowPlaybackRef.current = true;
					enableAllPreviewAudioTracks(vid);
					await vid.play().catch((err) => {
						console.log("PLAY ERROR:", err);
						throw err;
					});
					const supplementalAudio = supplementalAudioRef.current;
					if (supplementalAudio) {
						supplementalAudio.currentTime = vid.currentTime;
						supplementalAudio.playbackRate = vid.playbackRate;
						await supplementalAudio.play().catch(() => {
							// The main video remains the source of truth for playback state.
						});
					}
				} catch (error) {
					allowPlaybackRef.current = false;
					throw error;
				}
			},
			pause: () => {
				timelinePlaybackRef.current?.pause();
				const video = videoRef.current;
				allowPlaybackRef.current = false;
				if (!video) {
					return;
				}
				video.pause();
				supplementalAudioRef.current?.pause();
			},
			seek: (seconds) => {
				if (timelinePlaybackRef.current) timelinePlaybackRef.current.seek(seconds);
				else if (videoRef.current) videoRef.current.currentTime = seconds;
			},
		}));

		const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;

			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;

			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;

			const rect = overlayEl.getBoundingClientRect();
			const stageWidth = rect.width;
			const stageHeight = rect.height;

			if (!stageWidth || !stageHeight) {
				return;
			}

			stageSizeRef.current = { width: stageWidth, height: stageHeight };

			const localX = clientX - rect.left;
			const localY = clientY - rect.top;

			const unclampedFocus: ZoomFocus = {
				cx: clamp01(localX / stageWidth),
				cy: clamp01(localY / stageHeight),
			};
			const clampedFocus = clampFocusForRegion(unclampedFocus, region);

			onZoomFocusChange(region.id, clampedFocus);
			updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
		};

		const canTransformMainVideo =
			webcamLayoutPreset !== "vertical-stack" && webcamLayoutPreset !== "dual-frame";
		const pauseForCanvasEditing = () => {
			if (!isPlayingRef.current) return;
			allowPlaybackRef.current = false;
			videoRef.current?.pause();
			supplementalAudioRef.current?.pause();
			webcamVideoRef.current?.pause();
			isPlayingRef.current = false;
			onPlayStateChangeRef.current(false);
		};

		const updateMainVideoPosition = (clientX: number, clientY: number, bypass = false) => {
			const overlayEl = overlayRef.current;
			const layout = mainVideoLayout;
			if (!overlayEl || !layout || !onVideoPositionChange) return;
			const rect = overlayEl.getBoundingClientRect();
			if (!rect.width || !rect.height) return;

			const halfWidth = layout.width / 2;
			const halfHeight = layout.height / 2;
			const centerX = Math.max(
				halfWidth,
				Math.min(rect.width - halfWidth, clientX - rect.left - mainVideoDragOffsetRef.current.dx),
			);
			const centerY = Math.max(
				halfHeight,
				Math.min(rect.height - halfHeight, clientY - rect.top - mainVideoDragOffsetRef.current.dy),
			);
			const position = snapCanvasDrag(
				{ ...layout, id: "main-video", x: centerX - halfWidth, y: centerY - halfHeight },
				bypass,
				{
					minX: 0,
					maxX: Math.max(0, rect.width - layout.width),
					minY: 0,
					maxY: Math.max(0, rect.height - layout.height),
				},
			);
			onVideoPositionChange({
				cx: (position.x + halfWidth) / rect.width,
				cy: (position.y + halfHeight) / rect.height,
			});
		};

		const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
			pauseForCanvasEditing();
			const regionId = selectedZoomIdRef.current;
			if (regionId && event.shiftKey) {
				const region = zoomRegionsRef.current.find((r) => r.id === regionId);
				if (region && region.focusMode !== "auto") {
					onSelectZoom(region.id);
					event.preventDefault();
					isDraggingFocusRef.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
					updateFocusFromClientPoint(event.clientX, event.clientY);
					return;
				}
			}

			if (isBlankSlide || !canTransformMainVideo || !mainVideoLayout || !onVideoPositionChange) {
				return;
			}
			const overlayRect = event.currentTarget.getBoundingClientRect();
			const localX = event.clientX - overlayRect.left;
			const localY = event.clientY - overlayRect.top;
			const insideVideo =
				localX >= mainVideoLayout.x &&
				localX <= mainVideoLayout.x + mainVideoLayout.width &&
				localY >= mainVideoLayout.y &&
				localY <= mainVideoLayout.y + mainVideoLayout.height;
			if (!insideVideo) {
				setIsMainVideoSelected(false);
				return;
			}

			event.preventDefault();
			onSelectZoom(null);
			onSelectAnnotation?.(null);
			onSelectBlur?.(null);
			setIsMainVideoSelected(true);
			isDraggingMainVideoRef.current = true;
			mainVideoDragOffsetRef.current = {
				dx: localX - (mainVideoLayout.x + mainVideoLayout.width / 2),
				dy: localY - (mainVideoLayout.y + mainVideoLayout.height / 2),
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		};

		const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
			if (isDraggingFocusRef.current) {
				event.preventDefault();
				updateFocusFromClientPoint(event.clientX, event.clientY);
				return;
			}
			if (isDraggingMainVideoRef.current) {
				event.preventDefault();
				updateMainVideoPosition(event.clientX, event.clientY, event.altKey);
			}
		};

		const endOverlayDrag = (event: React.PointerEvent<HTMLDivElement>) => {
			const endedFocusDrag = isDraggingFocusRef.current;
			const endedMainVideoDrag = isDraggingMainVideoRef.current;
			if (!endedFocusDrag && !endedMainVideoDrag) return;
			isDraggingFocusRef.current = false;
			isDraggingMainVideoRef.current = false;
			clearSnapGuides();
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer may already be released.
			}
			if (endedFocusDrag) onZoomFocusDragEnd?.();
			if (endedMainVideoDrag) onVideoPositionDragEnd?.();
		};

		const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
			endOverlayDrag(event);
		};

		const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
			endOverlayDrag(event);
		};

		const handleMainVideoResizeStart = (
			event: React.PointerEvent<HTMLButtonElement>,
			directionX: -1 | 1,
			directionY: -1 | 1,
		) => {
			if (!onVideoScaleChange) return;
			pauseForCanvasEditing();
			event.preventDefault();
			event.stopPropagation();
			setIsMainVideoSelected(true);
			mainVideoResizeRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				startScale: videoScale,
				directionX,
				directionY,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		};

		const handleMainVideoResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
			const resize = mainVideoResizeRef.current;
			const overlayEl = overlayRef.current;
			if (!resize || !overlayEl || !onVideoScaleChange) return;
			event.preventDefault();
			event.stopPropagation();
			const rect = overlayEl.getBoundingClientRect();
			const reference = Math.max(1, Math.hypot(rect.width, rect.height));
			const outwardDistance =
				((event.clientX - resize.startX) * resize.directionX +
					(event.clientY - resize.startY) * resize.directionY) /
				Math.SQRT2;
			const nextScale = Math.max(
				MIN_VIDEO_SCALE,
				Math.min(MAX_VIDEO_SCALE, resize.startScale + (outwardDistance / reference) * 1.5),
			);
			onVideoScaleChange(Math.round(nextScale * 1000) / 1000);
		};

		const handleMainVideoResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
			if (!mainVideoResizeRef.current) return;
			mainVideoResizeRef.current = null;
			event.stopPropagation();
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer may already be released.
			}
			onVideoScaleDragEnd?.();
		};

		// ── Webcam PiP drag handlers ──

		const handleWebcamPointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (isPlayingRef.current) return;
			if (webcamLayoutPreset !== "picture-in-picture") return;
			event.preventDefault();
			event.stopPropagation();
			isDraggingWebcamRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);

			const webcamEl = event.currentTarget;
			const webcamRect = webcamEl.getBoundingClientRect();
			webcamDragOffsetRef.current = {
				dx: event.clientX - (webcamRect.left + webcamRect.width / 2),
				dy: event.clientY - (webcamRect.top + webcamRect.height / 2),
			};
		};

		const handleWebcamPointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (!isDraggingWebcamRef.current) return;
			event.preventDefault();
			event.stopPropagation();

			const containerEl = containerRef.current;
			if (!containerEl || !onWebcamPositionChange || !webcamLayout) return;

			const containerRect = containerEl.getBoundingClientRect();
			if (!containerRect.width || !containerRect.height) return;
			const cx = clamp01(
				(event.clientX - webcamDragOffsetRef.current.dx - containerRect.left) / containerRect.width,
			);
			const cy = clamp01(
				(event.clientY - webcamDragOffsetRef.current.dy - containerRect.top) / containerRect.height,
			);
			const bounds = {
				minX: 0,
				maxX: Math.max(0, overlaySize.width - webcamLayout.width),
				minY: 0,
				maxY: Math.max(0, overlaySize.height - webcamLayout.height),
			};
			const position = snapCanvasDrag(
				{
					...webcamLayout,
					id: "webcam",
					x: Math.max(0, Math.min(bounds.maxX, cx * overlaySize.width - webcamLayout.width / 2)),
					y: Math.max(0, Math.min(bounds.maxY, cy * overlaySize.height - webcamLayout.height / 2)),
				},
				event.altKey,
				bounds,
			);
			onWebcamPositionChange({
				cx: (position.x + webcamLayout.width / 2) / overlaySize.width,
				cy: (position.y + webcamLayout.height / 2) / overlaySize.height,
			});
		};

		const handleWebcamPointerUp = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (!isDraggingWebcamRef.current) return;
			isDraggingWebcamRef.current = false;
			clearSnapGuides();
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer may already be released.
			}
			onWebcamPositionDragEnd?.();
		};

		useEffect(() => {
			zoomRegionsRef.current = zoomRegions;
		}, [zoomRegions]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
		}, [cursorTelemetry]);

		useEffect(() => {
			cursorClickTimestampsRef.current = cursorClickTimestamps;
		}, [cursorClickTimestamps]);

		useEffect(() => {
			selectedZoomIdRef.current = selectedZoomId;
		}, [selectedZoomId]);

		useEffect(() => {
			isPlayingRef.current = isPlaying;
		}, [isPlaying]);

		useEffect(() => {
			trimRegionsRef.current = trimRegions;
		}, [trimRegions]);

		useEffect(() => {
			speedRegionsRef.current = speedRegions;
		}, [speedRegions]);

		useEffect(() => {
			annotationRegionsRef.current = annotationRegions;
		}, [annotationRegions]);

		useEffect(() => {
			motionBlurAmountRef.current = motionBlurAmount;
		}, [motionBlurAmount]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
		}, [cursorTelemetry]);

		useEffect(() => {
			showCursorRef.current = showCursor;
		}, [showCursor]);

		useEffect(() => {
			hasNativeCursorRecordingRef.current = hasNativeCursorRecording;
		}, [hasNativeCursorRecording]);

		useEffect(() => {
			cursorRecordingDataRef.current = cursorRecordingData;
			resetNativeCursorMotionBlurState(nativeCursorMotionBlurStateRef.current);
		}, [cursorRecordingData]);

		useEffect(() => {
			cropRegionRef.current = cropRegion;
		}, [cropRegion]);

		useEffect(() => {
			cursorSizeRef.current = cursorSize;
		}, [cursorSize]);

		useEffect(() => {
			cursorSmoothingRef.current = cursorSmoothing;
		}, [cursorSmoothing]);

		useEffect(() => {
			cursorMotionBlurRef.current = cursorMotionBlur;
		}, [cursorMotionBlur]);

		useEffect(() => {
			cursorClickBounceRef.current = cursorClickBounce;
		}, [cursorClickBounce]);

		useEffect(() => {
			cursorClipToBoundsRef.current = cursorClipToBounds;
		}, [cursorClipToBounds]);

		useEffect(() => {
			cursorThemeRef.current = cursorTheme;
		}, [cursorTheme]);

		useEffect(() => {
			cursorHighlightRef.current = cursorHighlight;
		}, [cursorHighlight]);

		useEffect(() => {
			cursorHighlightSizeRef.current = cursorHighlightSize;
		}, [cursorHighlightSize]);

		useEffect(() => {
			webcamReactiveZoomRef.current = webcamReactiveZoom;
			webcamLayoutPresetRef.current = webcamLayoutPreset;
			webcamPositionRef.current = webcamPosition;
			// Clear any reactive transform when the effect is turned off or layout changes,
			// so a stale shrink doesn't linger while the ticker isn't updating it.
			if (
				webcamWrapperRef.current &&
				(!webcamReactiveZoom || webcamLayoutPreset !== "picture-in-picture")
			) {
				webcamWrapperRef.current.style.transform = "";
			}
		}, [webcamReactiveZoom, webcamLayoutPreset, webcamPosition]);

		useEffect(() => {
			isPreviewingZoomRef.current = isPreviewingZoom;
		}, [isPreviewingZoom]);

		// Sync cursor overlay config when settings change
		useEffect(() => {
			const overlay = cursorOverlayRef.current;
			if (!overlay) return;
			overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
			overlay.setSmoothingFactor(cursorSmoothing);
			overlay.setMotionBlur(cursorMotionBlur);
			overlay.setClickBounce(cursorClickBounce);
			overlay.setHighlight(cursorHighlight);
			overlay.setHighlightSize(cursorHighlightSize);
			overlay.reset();
		}, [
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorHighlight,
			cursorHighlightSize,
		]);

		useEffect(() => {
			onTimeUpdateRef.current = onTimeUpdate;
		}, [onTimeUpdate]);

		useEffect(() => {
			onPlayStateChangeRef.current = onPlayStateChange;
		}, [onPlayStateChange]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const el = overlayRef.current;
			if (!el) return;

			// Seed immediately so overlays never start at 800×600
			setOverlaySize({ width: el.clientWidth, height: el.clientHeight });

			const observer = new ResizeObserver((entries) => {
				if (!entries[0]) return;
				const { width, height } = entries[0].contentRect;
				setOverlaySize((prev) => {
					if (prev.width === width && prev.height === height) return prev;
					return { width, height };
				});
			});

			observer.observe(el);
			return () => observer.disconnect();
		}, [pixiReady, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const container = containerRef.current;
			if (!container) return;

			if (typeof ResizeObserver === "undefined") {
				return;
			}

			const observer = new ResizeObserver(() => {
				layoutVideoContent();
			});

			observer.observe(container);
			return () => {
				observer.disconnect();
			};
		}, [pixiReady, videoReady, layoutVideoContent]);

		// Drop canvas resolution to 1.0 while scrubbing and restore native DPR on play/idle.
		// Only on scrub-state transitions; mutating renderer.resolution per-frame thrashes
		// texture uploads.
		useEffect(() => {
			if (!pixiReady) return;
			const app = appRef.current;
			const container = containerRef.current;
			if (!app || !container) return;

			const targetResolution = isScrubbing ? 1 : window.devicePixelRatio || 1;
			if (app.renderer.resolution === targetResolution) return;

			app.renderer.resolution = targetResolution;
			app.renderer.resize(container.clientWidth, container.clientHeight);
			layoutVideoContentRef.current?.();
		}, [isScrubbing, pixiReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			updateOverlayForRegion(selectedZoom);
		}, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const overlayEl = overlayElement;
			if (!overlayEl) return;
			if (!selectedZoom) {
				overlayEl.style.cursor = "default";
				overlayEl.style.pointerEvents = "none";
				return;
			}
			overlayEl.style.cursor = isPlaying ? "not-allowed" : "grab";
			overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
		}, [selectedZoom, isPlaying, pixiReady, videoReady, overlayElement]);

		useEffect(() => {
			const overlayEl = overlayElement;
			if (!overlayEl) return;

			const updateOverlaySize = () => {
				const width = overlayEl.clientWidth || 800;
				const height = overlayEl.clientHeight || 600;
				setOverlaySize((prev) => {
					if (prev.width === width && prev.height === height) return prev;
					return { width, height };
				});
			};

			updateOverlaySize();

			if (typeof ResizeObserver !== "undefined") {
				const observer = new ResizeObserver(() => {
					updateOverlaySize();
				});
				observer.observe(overlayEl);
				return () => observer.disconnect();
			}

			window.addEventListener("resize", updateOverlaySize);
			return () => window.removeEventListener("resize", updateOverlaySize);
		}, [overlayElement]);

		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			let mounted = true;
			let app: Application | null = null;

			(async () => {
				let cursorOverlayEnabled = true;
				try {
					await preloadCursorAssets();
				} catch {
					cursorOverlayEnabled = false;
				}

				app = new Application();

				await app.init({
					width: container.clientWidth,
					height: container.clientHeight,
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
				});

				app.ticker.maxFPS = 60;

				if (!mounted) {
					app.destroy(true, {
						children: true,
						texture: true,
						textureSource: true,
					});
					return;
				}

				appRef.current = app;
				container.appendChild(app.canvas);

				// Camera container - this will be scaled/positioned for zoom
				const cameraContainer = new Container();
				cameraContainerRef.current = cameraContainer;
				app.stage.addChild(cameraContainer);

				// Video container - holds the masked video sprite
				const videoContainer = new Container();
				videoContainerRef.current = videoContainer;
				cameraContainer.addChild(videoContainer);

				// Cursor overlay - rendered above the masked video
				if (cursorOverlayEnabled) {
					const cursorOverlay = new PixiCursorOverlay({
						dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
						smoothingFactor: cursorSmoothingRef.current,
						motionBlur: cursorMotionBlurRef.current,
						clickBounce: cursorClickBounceRef.current,
						highlight: cursorHighlightRef.current,
						highlightSize: cursorHighlightSizeRef.current,
					});
					cursorOverlayRef.current = cursorOverlay;
				}

				setPixiReady(true);
			})();

			return () => {
				mounted = false;
				setPixiReady(false);
				if (cursorOverlayRef.current) {
					cursorOverlayRef.current.destroy();
					cursorOverlayRef.current = null;
				}
				nativeCursorSpriteRef.current = null;
				nativeCursorTextureIdRef.current = null;
				nativeCursorImageIdRef.current = null;
				if (app && app.renderer) {
					app.destroy(true, {
						children: true,
						texture: true,
						textureSource: true,
					});
				}
				appRef.current = null;
				cameraContainerRef.current = null;
				videoContainerRef.current = null;
				videoSpriteRef.current = null;
			};
		}, []);

		useEffect(() => {
			if (!videoPath) {
				lastResolvedDurationRef.current = null;
				isResolvingDurationRef.current = false;
				setVideoReady(false);
				setSupplementalAudioPath(null);
				return;
			}

			let cancelled = false;
			window.electronAPI
				?.preparePreviewAudioTrack?.(videoPath)
				.then((result) => {
					if (!cancelled) {
						setSupplementalAudioPath(result.success ? (result.path ?? null) : null);
					}
				})
				.catch(() => {
					if (!cancelled) {
						setSupplementalAudioPath(null);
					}
				});

			const video = videoRef.current;
			if (!video) {
				return () => {
					cancelled = true;
				};
			}
			video.pause();
			video.currentTime = 0;
			allowPlaybackRef.current = false;
			lockedVideoDimensionsRef.current = null;
			lastResolvedDurationRef.current = null;
			isResolvingDurationRef.current = false;
			if (durationResolutionTimeoutRef.current) {
				clearTimeout(durationResolutionTimeoutRef.current);
				durationResolutionTimeoutRef.current = null;
			}
			setVideoReady(false);
			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}
			video.load();

			return () => {
				cancelled = true;
			};
		}, [videoPath]);

		useEffect(() => {
			const video = videoRef.current;
			const supplementalAudio = supplementalAudioRef.current;
			if (!video || !supplementalAudio || !supplementalAudioPath) {
				return;
			}

			const activeSpeedRegion =
				speedRegions.find(
					(region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
				) ?? null;
			supplementalAudio.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

			if (!isPlaying || isBlankSlide) {
				supplementalAudio.pause();
				if (Math.abs(supplementalAudio.currentTime - sourceTime) > 0.05) {
					supplementalAudio.currentTime = sourceTime;
				}
				return;
			}

			if (Math.abs(supplementalAudio.currentTime - video.currentTime) > 0.15) {
				supplementalAudio.currentTime = video.currentTime;
			}

			supplementalAudio.play().catch(() => {
				// Keep video playback running even if supplemental preview audio is unavailable.
			});
		}, [currentTime, sourceTime, isBlankSlide, isPlaying, speedRegions, supplementalAudioPath]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const video = videoRef.current;
			const app = appRef.current;
			const videoContainer = videoContainerRef.current;

			if (!video || !app || !videoContainer) return;
			if (video.videoWidth === 0 || video.videoHeight === 0) return;

			const source = VideoSource.from(video);
			if ("autoPlay" in source) {
				(source as { autoPlay?: boolean }).autoPlay = false;
			}
			if ("autoUpdate" in source) {
				(source as { autoUpdate?: boolean }).autoUpdate = true;
			}
			const videoTexture = Texture.from(source);

			const videoSprite = new Sprite(videoTexture);
			videoSpriteRef.current = videoSprite;

			const maskGraphics = new Graphics();
			videoContainer.addChild(videoSprite);
			videoContainer.addChild(maskGraphics);
			videoContainer.mask = maskGraphics;
			maskGraphicsRef.current = maskGraphics;
			const nativeCursorSprite = new Sprite(Texture.EMPTY);
			nativeCursorSprite.visible = false;
			nativeCursorSprite.eventMode = "none";
			nativeCursorSpriteRef.current = nativeCursorSprite;
			if (cursorOverlayRef.current) {
				videoContainer.addChild(cursorOverlayRef.current.container);
			}

			videoContainer.addChild(nativeCursorSprite);

			animationStateRef.current = {
				scale: 1,
				focusX: DEFAULT_FOCUS.cx,
				focusY: DEFAULT_FOCUS.cy,
				progress: 0,
				x: 0,
				y: 0,
				appliedScale: 1,
			};

			const blurFilter = new BlurFilter();
			blurFilter.quality = 3;
			blurFilter.resolution = app.renderer.resolution;
			blurFilter.blur = 0;
			const motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
			blurFilterRef.current = blurFilter;
			motionBlurFilterRef.current = motionBlurFilter;

			layoutVideoContentRef.current?.();
			video.pause();

			const timelinePlayback = createInsertedSlidePlayback({
				video,
				isSeekingRef,
				isPlayingRef,
				allowPlaybackRef,
				currentTimeRef,
				onPlayStateChange: (playing) => onPlayStateChangeRef.current(playing),
				onTimeUpdate: (time) => onTimeUpdateRef.current(time),
				trimRegionsRef,
				speedRegionsRef,
				blankSlideRegionsRef,
				isScrubbingRef,
				onScrubChange: (scrubbing) => setIsScrubbing(scrubbing),
				getSourceDurationSec: () =>
					lastResolvedDurationRef.current ?? getResolvedVideoDuration(video) ?? 0,
			});
			timelinePlaybackRef.current = timelinePlayback;
			const { handlePlay, handlePause, handleSeeked, handleSeeking } = timelinePlayback;

			video.addEventListener("play", handlePlay);
			video.addEventListener("pause", handlePause);
			video.addEventListener("ended", handlePause);
			video.addEventListener("seeked", handleSeeked);
			video.addEventListener("seeking", handleSeeking);

			return () => {
				timelinePlayback.destroy();
				if (timelinePlaybackRef.current === timelinePlayback) timelinePlaybackRef.current = null;
				video.removeEventListener("play", handlePlay);
				video.removeEventListener("pause", handlePause);
				video.removeEventListener("ended", handlePause);
				video.removeEventListener("seeked", handleSeeked);
				video.removeEventListener("seeking", handleSeeking);

				if (timeUpdateAnimationRef.current) {
					cancelAnimationFrame(timeUpdateAnimationRef.current);
				}

				if (videoSprite) {
					videoContainer.removeChild(videoSprite);
					videoSprite.destroy();
				}
				if (maskGraphics) {
					videoContainer.removeChild(maskGraphics);
					maskGraphics.destroy();
				}
				if (nativeCursorSpriteRef.current) {
					videoContainer.removeChild(nativeCursorSpriteRef.current);
					nativeCursorSpriteRef.current.destroy();
					nativeCursorSpriteRef.current = null;
					nativeCursorTextureIdRef.current = null;
				}
				videoContainer.mask = null;
				maskGraphicsRef.current = null;
				if (blurFilterRef.current) {
					videoContainer.filters = null;
					blurFilterRef.current.destroy();
					blurFilterRef.current = null;
				}
				if (motionBlurFilterRef.current) {
					motionBlurFilterRef.current.destroy();
					motionBlurFilterRef.current = null;
				}
				videoTexture.destroy(true);

				videoSpriteRef.current = null;
			};
		}, [pixiReady, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const videoContainer = videoContainerRef.current;
			if (!app || !videoSprite || !videoContainer) return;

			const applyTransformFn = (
				transform: { scale: number; x: number; y: number },
				targetFocus: ZoomFocus,
				motionIntensity: number,
				motionVector: { x: number; y: number },
			) => {
				const cameraContainer = cameraContainerRef.current;
				if (!cameraContainer) return;

				const state = animationStateRef.current;

				const appliedTransform = applyZoomTransform({
					cameraContainer,
					blurFilter: blurFilterRef.current,
					motionBlurFilter: motionBlurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: targetFocus.cx,
					focusY: targetFocus.cy,
					motionIntensity,
					motionVector,
					isPlaying: isPlayingRef.current,
					motionBlurAmount: motionBlurAmountRef.current,
					transformOverride: transform,
					motionBlurState: motionBlurStateRef.current,
					// Content time, not wall-clock, so motion-blur velocity matches export and stays
					// correct under speed regions (frameRenderer passes the same content timeMs).
					frameTimeMs: currentTimeRef.current,
				});

				state.x = appliedTransform.x;
				state.y = appliedTransform.y;
				state.appliedScale = appliedTransform.scale;

				// Scale the PiP webcam inversely with the (eased) zoom, anchored to the docked
				// corner (bottom-right by default) so it stays flush instead of drifting to center.
				const webcamWrapper = webcamWrapperRef.current;
				if (webcamWrapper) {
					const reactive =
						webcamReactiveZoomRef.current && webcamLayoutPresetRef.current === "picture-in-picture";
					const factor = reactive ? reactiveWebcamScale(state.appliedScale) : 1;
					if (factor < 1) {
						const pos = webcamPositionRef.current;
						const originX = (pos ? pos.cx >= 0.5 : true) ? "100%" : "0%";
						const originY = (pos ? pos.cy >= 0.5 : true) ? "100%" : "0%";
						webcamWrapper.style.transformOrigin = `${originX} ${originY}`;
						webcamWrapper.style.transform = `scale(${factor})`;
					} else {
						webcamWrapper.style.transform = "";
					}
				}
			};

			let lastMotionBlurActive: boolean | null = null;
			let lastTransformIsIdentity = true;
			let lastPerspectiveValue = 0;
			const ticker = () => {
				const { region, strength, blendedScale, rotation3D, transition } = findDominantRegion(
					zoomRegionsRef.current,
					currentTimeRef.current,
					{
						connectZooms: true,
						cursorTelemetry: slideAwareCursorTelemetry(
							cursorTelemetryRef.current,
							blankSlideRegionsRef.current,
						),
					},
				);

				const defaultFocus = DEFAULT_FOCUS;
				let targetScaleFactor = 1;
				let targetFocus = defaultFocus;
				let targetProgress = 0;

				// If a zoom is selected but not playing, show the default unzoomed view.
				const selectedId = selectedZoomIdRef.current;
				const hasSelectedZoom = selectedId !== null;
				const shouldShowUnzoomedView =
					hasSelectedZoom && !isPlayingRef.current && !isPreviewingZoomRef.current;

				if (region && strength > 0 && !shouldShowUnzoomedView) {
					// Use getZoomScale (customScale-aware) to match export and the magnification
					// findDominantRegion resolved focus at. Falling back to the depth preset would
					// zoom/pan to a different level than export.
					const zoomScale = blendedScale ?? getZoomScale(region);
					const regionFocus = region.focus;

					targetScaleFactor = zoomScale;
					targetFocus = regionFocus;
					targetProgress = strength;

					// Adaptive smoothing for auto-follow mode.
					if (region.focusMode === "auto" && !transition) {
						const raw = targetFocus;
						const isZoomingIn =
							targetProgress < 0.999 && targetProgress >= prevTargetProgressRef.current;
						// Follow the cursor in content time (frame-rate independent) so the camera pans
						// at the same speed in preview and export. Snap to target when not actively
						// playing (paused/seek/scrub), matching the zoom spring's snap.
						const focusAnimating =
							isPlayingRef.current && !isSeekingRef.current && !isScrubbingRef.current;
						const focusDtMs =
							prevZoomTimeMsRef.current === null
								? 0
								: currentTimeRef.current - prevZoomTimeMsRef.current;
						if (targetProgress >= 0.999) {
							// Full zoom: adaptive smoothing, faster when far, decelerating when close.
							const prev = smoothedAutoFocusRef.current ?? raw;
							const smoothed = focusAnimating
								? advanceFollowFocus(prev, raw, focusDtMs, AUTO_FOLLOW_PARAMS)
								: raw;
							smoothedAutoFocusRef.current = smoothed;
							targetFocus = smoothed;
						} else if (isZoomingIn) {
							// Zoom-in: track cursor directly so zoom always aims at the current position;
							// keep ref in sync to avoid a snap when full-zoom begins.
							smoothedAutoFocusRef.current = raw;
						} else {
							// Zoom-out: keep smoothing for continuity to avoid a snap at zoom-out start.
							const prev = smoothedAutoFocusRef.current ?? raw;
							const smoothed = focusAnimating
								? advanceFollowFocus(prev, raw, focusDtMs, AUTO_FOLLOW_PARAMS)
								: raw;
							smoothedAutoFocusRef.current = smoothed;
							targetFocus = smoothed;
						}
					} else if (region.focusMode !== "auto") {
						smoothedAutoFocusRef.current = null;
					}
					prevTargetProgressRef.current = targetProgress;

					// Connected zoom transitions: pan between adjacent regions.
					if (transition) {
						const startTransform = computeZoomTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.startScale,
							zoomProgress: 1,
							focusX: transition.startFocus.cx,
							focusY: transition.startFocus.cy,
						});
						const endTransform = computeZoomTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.endScale,
							zoomProgress: 1,
							focusX: transition.endFocus.cx,
							focusY: transition.endFocus.cy,
						});

						const interpolatedTransform = {
							scale:
								startTransform.scale +
								(endTransform.scale - startTransform.scale) * transition.progress,
							x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
							y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
						};

						targetScaleFactor = interpolatedTransform.scale;
						targetFocus = computeFocusFromTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: interpolatedTransform.scale,
							x: interpolatedTransform.x,
							y: interpolatedTransform.y,
						});
						targetProgress = 1;
					}
				}

				const state = animationStateRef.current;
				const prevScale = state.appliedScale;
				const prevX = state.x;
				const prevY = state.y;

				state.scale = targetScaleFactor;
				state.focusX = targetFocus.cx;
				state.focusY = targetFocus.cy;
				state.progress = targetProgress;

				const projectedTransform = computeZoomTransform({
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: state.focusX,
					focusY: state.focusY,
				});

				// Chase the eased target with a spring so the camera glides (no jerk at the steep
				// start of the ease, no snap at close-region seams). Step by content time while
				// playing; snap to the exact target when paused/seeking/scrubbing for crisp frames.
				const nowMs = currentTimeRef.current;
				const prevMs = prevZoomTimeMsRef.current;
				const animating = isPlayingRef.current && !isSeekingRef.current && !isScrubbingRef.current;
				const dtMs = prevMs === null ? 0 : nowMs - prevMs;
				let appliedScale: number;
				let appliedX: number;
				let appliedY: number;
				if (!animating || prevMs === null || dtMs <= 0 || dtMs > 80) {
					resetZoomSpring(zoomSpringRef.current, projectedTransform);
					appliedScale = projectedTransform.scale;
					appliedX = projectedTransform.x;
					appliedY = projectedTransform.y;
				} else {
					const sprung = stepZoomSpring(zoomSpringRef.current, projectedTransform, dtMs);
					appliedScale = sprung.scale;
					appliedX = sprung.x;
					appliedY = sprung.y;
				}
				prevZoomTimeMsRef.current = nowMs;

				const motionIntensity = Math.max(
					Math.abs(appliedScale - prevScale),
					Math.abs(appliedX - prevX) / Math.max(1, stageSizeRef.current.width),
					Math.abs(appliedY - prevY) / Math.max(1, stageSizeRef.current.height),
				);

				const motionVector = {
					x: appliedX - prevX,
					y: appliedY - prevY,
				};

				applyTransformFn(
					{ scale: appliedScale, x: appliedX, y: appliedY },
					targetFocus,
					motionIntensity,
					motionVector,
				);

				const isMotionBlurActive =
					(motionBlurAmountRef.current || 0) > 0 && isPlayingRef.current && !isScrubbingRef.current;

				if (isMotionBlurActive !== lastMotionBlurActive && videoContainerRef.current) {
					if (isMotionBlurActive) {
						if (blurFilterRef.current && motionBlurFilterRef.current) {
							videoContainerRef.current.filters = [
								blurFilterRef.current,
								motionBlurFilterRef.current,
							];
							lastMotionBlurActive = true;
						}
					} else {
						videoContainerRef.current.filters = null;
						lastMotionBlurActive = false;
					}
				}

				// Update cursor overlay
				const cursorTimeMs = timelineToSourceMs(
					currentTimeRef.current,
					blankSlideRegionsRef.current,
				);
				const hideCursorForSpotlight = hasActiveRectangleSpotlight(
					annotationRegionsRef.current,
					currentTimeRef.current,
				);
				const cursorOverlay = cursorOverlayRef.current;
				if (cursorOverlay) {
					cursorOverlay.update(
						cursorTelemetryRef.current,
						cursorTimeMs,
						baseMaskRef.current,
						showCursorRef.current &&
							!hasNativeCursorRecordingRef.current &&
							!hideCursorForSpotlight,
						!isPlayingRef.current || isSeekingRef.current,
					);
				}

				// Keep the native cursor preview in the same transformed coordinate space as PIXI.
				const nativeCursorSprite = nativeCursorSpriteRef.current;
				const nativeCursorImage = nativeCursorImageRef.current;
				const nativeCursorHighlight = nativeCursorHighlightRef.current;
				const hideNativeCursorPreview = () => {
					if (nativeCursorSprite) {
						nativeCursorSprite.visible = false;
					}
					if (nativeCursorImage) {
						nativeCursorImage.style.display = "none";
						nativeCursorImage.style.filter = "none";
					}
					if (nativeCursorHighlight) {
						nativeCursorHighlight.style.display = "none";
					}
					if (nativeCursorClipRef.current) {
						nativeCursorClipRef.current.style.clipPath = "";
					}
					resetNativeCursorMotionBlurState(nativeCursorMotionBlurStateRef.current);
				};
				if (nativeCursorImage) {
					if (
						hasNativeCursorRecordingRef.current &&
						showCursorRef.current &&
						!hideCursorForSpotlight
					) {
						const timeMs = cursorTimeMs;
						const frame = resolveInterpolatedNativeCursorFrame(
							cursorRecordingDataRef.current,
							timeMs,
						);
						if (frame) {
							// Position comes from the precomputed offline-smoothed path; the frame still
							// supplies the cursor image, type, and click timing.
							const smoothedPos = getSmoothedCursorPath(
								cursorRecordingDataRef.current,
								cursorSmoothingRef.current,
							)?.sampleAt(timeMs);
							const displaySample = smoothedPos
								? { ...frame.sample, cx: smoothedPos.cx, cy: smoothedPos.cy }
								: frame.sample;
							const cameraContainer = cameraContainerRef.current;
							const videoContainer = videoContainerRef.current;
							const cropRegionValue = cropRegionRef.current ?? {
								x: 0,
								y: 0,
								width: 1,
								height: 1,
							};
							const projectedLocalPoint = projectNativeCursorToLocal({
								cropRegion: cropRegionValue,
								maskRect: baseMaskRef.current,
								sample: displaySample,
							});
							const projectedStagePoint =
								cameraContainer && videoContainer
									? projectNativeCursorToStage({
											cameraContainer,
											cropRegion: cropRegionValue,
											maskRect: baseMaskRef.current,
											videoContainerPosition: {
												x: videoContainer.x,
												y: videoContainer.y,
											},
											sample: displaySample,
										})
									: null;
							if (projectedLocalPoint && projectedStagePoint) {
								// Pass deviceScaleFactor=1 since asset.scaleFactor already encodes DPR.
								// Size is normalized below so preview matches export proportionally.
								const renderAsset = resolveNativeCursorRenderAsset(
									frame.asset,
									1,
									displaySample,
									cursorThemeRef.current,
								);
								const bounceProgress = getNativeCursorClickBounceProgress(
									cursorRecordingDataRef.current,
									timeMs,
								);
								const scale =
									Math.max(0, cursorSizeRef.current) *
									getNativeCursorClickBounceScale(cursorClickBounceRef.current, bounceProgress);
								// Normalize cursor size to the displayed video width so the cursor
								// appears at the same fraction of the video in both preview and export.
								const crop = cropRegionRef.current ?? {
									x: 0,
									y: 0,
									width: 1,
									height: 1,
								};
								const croppedVideoWidth = (videoRef.current?.videoWidth ?? 0) * crop.width;
								const sizeNorm =
									croppedVideoWidth > 0 ? baseMaskRef.current.width / croppedVideoWidth : 1;
								const transformedScale = scale * Math.abs(cameraContainer?.scale.x || 1) * sizeNorm;
								const blurPx =
									!isPlayingRef.current || isSeekingRef.current
										? 0
										: getNativeCursorMotionBlurPx({
												motionBlur: cursorMotionBlurRef.current,
												point: projectedStagePoint,
												state: nativeCursorMotionBlurStateRef.current,
												timeMs,
											});
								if (nativeCursorImageIdRef.current !== renderAsset.id) {
									nativeCursorImage.src = renderAsset.imageDataUrl;
									nativeCursorImageIdRef.current = renderAsset.id;
								}
								nativeCursorImage.style.display = "block";
								// Clip to the camera-aware video boundary. Works here because nativeCursorClipRef
								// sits outside preserve-3d. When cursorClipToBounds is off, let the cursor overflow.
								if (nativeCursorClipRef.current) {
									if (!cursorClipToBoundsRef.current) {
										nativeCursorClipRef.current.style.clipPath = "none";
									} else {
										const mask = baseMaskRef.current;
										const stage = stageSizeRef.current;
										const br = borderRadiusRef.current;
										const s = cameraContainer ? Math.abs(cameraContainer.scale.x) : 1;
										const camX = cameraContainer ? cameraContainer.position.x : 0;
										const camY = cameraContainer ? cameraContainer.position.y : 0;
										const clipLeft = camX + s * mask.x;
										const clipTop = camY + s * mask.y;
										const clipRight = camX + s * (mask.x + mask.width);
										const clipBottom = camY + s * (mask.y + mask.height);
										nativeCursorClipRef.current.style.clipPath = `inset(${clipTop}px ${stage.width - clipRight}px ${stage.height - clipBottom}px ${clipLeft}px round ${br * s}px)`;
									}
								}
								nativeCursorImage.style.width = `${renderAsset.width * transformedScale}px`;
								nativeCursorImage.style.height = `${renderAsset.height * transformedScale}px`;
								nativeCursorImage.style.filter =
									blurPx > 0 ? `blur(${blurPx.toFixed(2)}px)` : "none";
								if (nativeCursorHighlight) {
									if (cursorHighlightRef.current) {
										const cursorHeight = renderAsset.height * transformedScale;
										const highlightSize = getCursorHighlightDiameter(
											cursorHeight,
											cursorHighlightSizeRef.current,
										);
										nativeCursorHighlight.style.display = "block";
										nativeCursorHighlight.style.width = `${highlightSize}px`;
										nativeCursorHighlight.style.height = `${highlightSize}px`;
										nativeCursorHighlight.style.borderWidth = `${getCursorHighlightBorderWidth(cursorHeight)}px`;
										nativeCursorHighlight.style.transform = `translate3d(${projectedStagePoint.x - highlightSize / 2}px, ${projectedStagePoint.y - highlightSize / 2}px, 0)`;
									} else {
										nativeCursorHighlight.style.display = "none";
									}
								}
								// translate3d is relative to nativeCursorClipRef (absolute inset-0 = stage origin).
								// projectedStagePoint.x is the stage-space cursor position, so no offset is needed.
								nativeCursorImage.style.transform = `translate3d(${
									projectedStagePoint.x - renderAsset.hotspotX * transformedScale
								}px, ${projectedStagePoint.y - renderAsset.hotspotY * transformedScale}px, 0)`;
								if (nativeCursorSprite) {
									nativeCursorSprite.visible = false;
									if (nativeCursorTextureIdRef.current !== renderAsset.id) {
										nativeCursorSprite.texture = Texture.from(renderAsset.imageDataUrl);
										nativeCursorTextureIdRef.current = renderAsset.id;
									}
									nativeCursorSprite.position.set(
										projectedLocalPoint.x - renderAsset.hotspotX * scale,
										projectedLocalPoint.y - renderAsset.hotspotY * scale,
									);
									nativeCursorSprite.width = renderAsset.width * scale;
									nativeCursorSprite.height = renderAsset.height * scale;
								}
							} else {
								hideNativeCursorPreview();
							}
						} else {
							hideNativeCursorPreview();
						}
					} else {
						hideNativeCursorPreview();
					}
				} else {
					hideNativeCursorPreview();
				}

				const composite3D = composite3DRef.current;
				const outerWrapper = outerWrapperRef.current;
				if (composite3D && outerWrapper) {
					const effectiveRotation =
						region && targetProgress > 0 && !shouldShowUnzoomedView
							? lerpRotation3D(DEFAULT_ROTATION_3D, rotation3D, targetProgress)
							: DEFAULT_ROTATION_3D;
					const isIdentity = isRotation3DIdentity(effectiveRotation);
					if (isIdentity) {
						if (!lastTransformIsIdentity) {
							composite3D.style.transform = "";
							composite3D.style.willChange = "auto";
							lastTransformIsIdentity = true;
						}
						if (nativeCursorClipRef.current) {
							nativeCursorClipRef.current.style.transform = "";
						}
						if (lastPerspectiveValue !== 0) {
							outerWrapper.style.perspective = "";
							lastPerspectiveValue = 0;
						}
					} else {
						const wrapperW = outerWrapper.clientWidth || 1;
						const wrapperH = outerWrapper.clientHeight || 1;
						const persp = rotation3DPerspective(wrapperW, wrapperH);
						const containScale = computeRotation3DContainScale(
							effectiveRotation,
							wrapperW,
							wrapperH,
							persp,
						);
						composite3D.style.transform = `scale(${containScale}) rotateX(${effectiveRotation.rotationX}deg) rotateY(${effectiveRotation.rotationY}deg) rotateZ(${effectiveRotation.rotationZ}deg)`;
						composite3D.style.willChange = "transform";
						if (nativeCursorClipRef.current) {
							nativeCursorClipRef.current.style.transform = composite3D.style.transform;
						}
						lastTransformIsIdentity = false;
						if (persp !== lastPerspectiveValue) {
							outerWrapper.style.perspective = `${persp}px`;
							lastPerspectiveValue = persp;
						}
					}
				}
			};

			app.ticker.add(ticker);
			return () => {
				if (app && app.ticker) {
					app.ticker.remove(ticker);
				}
			};
		}, [pixiReady, videoReady]);

		const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = e.currentTarget;
			enableAllPreviewAudioTracks(video);
			const hasResolvedDuration = syncResolvedDuration(video);
			if (!hasResolvedDuration) {
				forceResolveDuration(video);
			} else {
				video.currentTime = 0;
			}
			video.pause();
			allowPlaybackRef.current = false;
			currentTimeRef.current = 0;

			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}

			const waitForRenderableFrame = () => {
				const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
				const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
				if (!syncResolvedDuration(video)) {
					forceResolveDuration(video);
				}
				if (hasDimensions && hasData) {
					videoReadyRafRef.current = null;
					setVideoReady(true);
					return;
				}
				videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
			};

			videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
		};

		const resolvedWallpaper = useMemo<string | null>(() => {
			const source = wallpaper || DEFAULT_WALLPAPER;
			const classified = classifyWallpaper(source);
			if (classified.kind !== "image") return classified.value;
			try {
				return resolveImageWallpaperUrl(classified.path);
			} catch (err) {
				console.warn("[VideoPlayback] wallpaper resolve failed:", err);
				return null;
			}
		}, [wallpaper]);
		const webcamCssBoxShadow = useMemo(
			() => getWebcamLayoutCssBoxShadow(webcamLayoutPreset),
			[webcamLayoutPreset],
		);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamVideoPath) {
				setWebcamDimensions(null);
				return;
			}

			const handleLoadedMetadata = () => {
				if (webcamVideo.videoWidth > 0 && webcamVideo.videoHeight > 0) {
					setWebcamDimensions({
						width: webcamVideo.videoWidth,
						height: webcamVideo.videoHeight,
					});
				}
			};

			webcamVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
			handleLoadedMetadata();
			return () => {
				webcamVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
			};
		}, [webcamVideoPath]);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamVideoPath) {
				return;
			}

			const activeSpeedRegion =
				speedRegions.find(
					(region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
				) ?? null;
			webcamVideo.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

			if (!isPlaying || isBlankSlide) {
				webcamVideo.pause();
				if (Math.abs(webcamVideo.currentTime - sourceTime) > 0.05) {
					webcamVideo.currentTime = sourceTime;
				}
				return;
			}

			if (Math.abs(webcamVideo.currentTime - sourceTime) > 0.15) {
				webcamVideo.currentTime = sourceTime;
			}

			webcamVideo.play().catch(() => {
				// Ignore webcam autoplay restoration failures.
			});
		}, [currentTime, sourceTime, isBlankSlide, isPlaying, speedRegions, webcamVideoPath]);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamVideoPath) {
				return;
			}

			webcamVideo.pause();
			webcamVideo.currentTime = 0;
		}, [webcamVideoPath]);

		useEffect(() => {
			return () => {
				if (videoReadyRafRef.current) {
					cancelAnimationFrame(videoReadyRafRef.current);
					videoReadyRafRef.current = null;
				}
				if (scrubEndTimerRef.current !== null) {
					window.clearTimeout(scrubEndTimerRef.current);
					scrubEndTimerRef.current = null;
				}
				if (durationResolutionTimeoutRef.current) {
					clearTimeout(durationResolutionTimeoutRef.current);
					durationResolutionTimeoutRef.current = null;
				}
			};
		}, []);

		const isImageUrl = Boolean(
			resolvedWallpaper &&
				(resolvedWallpaper.startsWith("file://") ||
					resolvedWallpaper.startsWith("http") ||
					resolvedWallpaper.startsWith("/") ||
					resolvedWallpaper.startsWith("data:")),
		);
		const backgroundStyle = isImageUrl
			? { backgroundImage: `url(${resolvedWallpaper || ""})` }
			: { background: resolvedWallpaper || "" };
		const slideBackgroundStyle = blankSlidePresentation?.region.backgroundColor
			? { background: blankSlidePresentation.region.backgroundColor }
			: backgroundStyle;

		return (
			<div
				ref={outerWrapperRef}
				className="relative rounded-sm overflow-hidden"
				style={{
					width: "100%",
					aspectRatio: formatAspectRatioForCSS(
						aspectRatio,
						aspectRatio === "native"
							? getNativeAspectRatioValue(
									lockedVideoDimensionsRef.current?.width || DEFAULT_SOURCE_DIMENSIONS.width,
									lockedVideoDimensionsRef.current?.height || DEFAULT_SOURCE_DIMENSIONS.height,
									cropRegion,
								)
							: undefined,
					),
				}}
			>
				{/* Background always renders as a DOM element so it can be blurred. */}
				<div
					className="absolute inset-0 bg-cover bg-center"
					style={{
						...backgroundStyle,
						filter: showBlur ? "blur(2px)" : "none",
					}}
				/>
				<div
					ref={composite3DRef}
					className="absolute inset-0"
					style={{
						transformStyle: "preserve-3d",
						transformOrigin: "center center",
					}}
				>
					<div
						ref={containerRef}
						className="absolute inset-0"
						style={{
							filter:
								showShadow && shadowIntensity > 0
									? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
									: "none",
						}}
					/>
					{webcamVideoPath &&
						(() => {
							const clipPath = getCssClipPath(webcamLayout?.maskShape ?? "rectangle");
							const useClipPath = !!clipPath;
							return (
								<div
									ref={webcamWrapperRef}
									className="absolute"
									style={{
										left: webcamLayout?.x ?? 0,
										top: webcamLayout?.y ?? 0,
										width: webcamLayout?.width ?? 0,
										height: webcamLayout?.height ?? 0,
										zIndex: 20,
										opacity: webcamLayout ? 1 : 0,
										filter:
											useClipPath && webcamCssBoxShadow !== "none"
												? `drop-shadow(${webcamCssBoxShadow})`
												: undefined,
									}}
								>
									<video
										ref={webcamVideoRef}
										src={webcamVideoPath}
										className={`w-full h-full object-cover ${webcamLayoutPreset === "picture-in-picture" ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
										style={{
											borderRadius: useClipPath ? 0 : (webcamLayout?.borderRadius ?? 0),
											clipPath: clipPath ?? undefined,
											boxShadow: useClipPath ? "none" : webcamCssBoxShadow,
											backgroundColor: "#000",
											transform: webcamMirrored ? "scaleX(-1)" : undefined,
										}}
										onPointerDown={handleWebcamPointerDown}
										onPointerMove={handleWebcamPointerMove}
										onPointerUp={handleWebcamPointerUp}
										onPointerLeave={handleWebcamPointerUp}
										muted
										preload="metadata"
										playsInline
									/>
								</div>
							);
						})()}
					{blankSlidePresentation && (
						<div
							aria-hidden="true"
							className="absolute inset-0 bg-cover bg-center pointer-events-none"
							style={{
								...slideBackgroundStyle,
								zIndex: 25,
								opacity: blankSlidePresentation.opacity,
								transform: slideTransform,
								transformOrigin: "center center",
								willChange: "transform, opacity",
								filter:
									!blankSlidePresentation.region.backgroundColor && showBlur ? "blur(2px)" : "none",
							}}
						/>
					)}
					{/* Render the overlay only once PIXI and video are ready. */}
					{pixiReady && videoReady && (
						<div
							ref={setOverlayRefs}
							className="absolute inset-0 select-none"
							style={{
								pointerEvents: "auto",
								zIndex: 30,
								cursor: isMainVideoSelected ? "move" : undefined,
							}}
							onPointerDown={handleOverlayPointerDown}
							onPointerMove={handleOverlayPointerMove}
							onPointerUp={handleOverlayPointerUp}
							onPointerLeave={handleOverlayPointerLeave}
						>
							<div
								ref={focusIndicatorRef}
								className="absolute rounded-md border border-[#34B27B]/80 bg-[#34B27B]/20 shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
								style={{ display: "none", pointerEvents: "none" }}
							/>
							{(() => {
								const filteredAnnotations = (annotationRegions || []).filter((annotation) => {
									if (
										typeof annotation.startMs !== "number" ||
										typeof annotation.endMs !== "number"
									)
										return false;

									if (annotation.id === selectedAnnotationId) return true;

									const timeMs = Math.round(currentTime * 1000);
									return timeMs >= annotation.startMs && timeMs < annotation.endMs;
								});

								const filteredBlurRegions = (blurRegions || []).filter((blurRegion) => {
									if (
										typeof blurRegion.startMs !== "number" ||
										typeof blurRegion.endMs !== "number"
									)
										return false;

									if (blurRegion.id === selectedBlurId) return true;

									const timeMs = Math.round(currentTime * 1000);
									return timeMs >= blurRegion.startMs && timeMs < blurRegion.endMs;
								});
								const annotationViewport = isBlankSlide
									? {
											x: 0,
											y: 0,
											width: overlaySize.width,
											height: overlaySize.height,
										}
									: (mainVideoLayout ?? {
											x: 0,
											y: 0,
											width: overlaySize.width,
											height: overlaySize.height,
										});

								const sorted = [
									...filteredAnnotations.map((annotation) => ({
										kind: "annotation" as const,
										region: annotation,
									})),
									...filteredBlurRegions.map((blurRegion) => ({
										kind: "blur" as const,
										region: blurRegion,
									})),
								].sort((a, b) => a.region.zIndex - b.region.zIndex);
								const highestRectangleZ = filteredAnnotations.reduce(
									(highest, annotation) =>
										annotation.type === "rectangle"
											? Math.max(highest, annotation.zIndex)
											: highest,
									0,
								);
								const canvasAnnotations = filteredAnnotations.filter(
									(annotation) => isBlankSlide || isCanvasAnchoredAnnotation(annotation),
								);
								const activeRectangles = filteredAnnotations.filter(
									(annotation) => annotation.type === "rectangle",
								);
								const viewportRectangles = activeRectangles.map((annotation) =>
									mapAnnotationToViewport(annotation, annotationViewport, overlaySize),
								);
								const maximumSpotlightZoom = activeRectangles.reduce(
									(maximum, rectangle) => Math.max(maximum, getRectangleSpotlightZoom(rectangle)),
									1,
								);
								const app = appRef.current;
								const needsPreviewSnapshot =
									!isBlankSlide && (filteredBlurRegions.length > 0 || activeRectangles.length > 0);
								const previewSnapshotCanvas = needsPreviewSnapshot
									? (() => {
											if (!app?.renderer?.extract) return null;
											try {
												const video = videoRef.current;
												const resolution =
													!isPlaying && activeRectangles.length > 0
														? getRectangleSpotlightSourceResolution(
																video?.videoWidth || overlaySize.width,
																video?.videoHeight || overlaySize.height,
																Math.max(1, annotationViewport.width),
																Math.max(1, annotationViewport.height),
																maximumSpotlightZoom,
															)
														: app.renderer.resolution;
												return app.renderer.extract.canvas({
													target: app.stage,
													frame: new Rectangle(
														annotationViewport.x,
														annotationViewport.y,
														Math.max(1, annotationViewport.width),
														Math.max(1, annotationViewport.height),
													),
													resolution,
													antialias: true,
												});
											} catch {
												return null;
											}
										})()
									: null;

								// Re-clicking a selected annotation cycles through any overlapping ones.
								const handleAnnotationClick = (clickedId: string) => {
									setIsMainVideoSelected(false);
									if (!onSelectAnnotation) return;

									if (clickedId === selectedAnnotationId && filteredAnnotations.length > 1) {
										const currentIndex = filteredAnnotations.findIndex((a) => a.id === clickedId);
										const nextIndex = (currentIndex + 1) % filteredAnnotations.length;
										onSelectAnnotation(filteredAnnotations[nextIndex].id);
									} else {
										onSelectAnnotation(clickedId);
									}
								};

								const handleBlurClick = (clickedId: string) => {
									setIsMainVideoSelected(false);
									onSelectBlur?.(clickedId);
								};

								return (
									<>
										{activeRectangles.length > 0 && (
											<svg
												aria-hidden="true"
												className="absolute inset-0 h-full w-full pointer-events-none"
												viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
												preserveAspectRatio="none"
												style={{
													zIndex: 0,
													opacity: isBlankSlide ? blankSlidePresentation?.opacity : undefined,
													transform: isBlankSlide ? slideTransform : undefined,
													transformOrigin: "center center",
												}}
											>
												<defs>
													<mask
														id={spotlightMaskId}
														maskUnits="userSpaceOnUse"
														x={0}
														y={0}
														width={overlaySize.width}
														height={overlaySize.height}
													>
														<rect width="100%" height="100%" fill="white" />
														{viewportRectangles.map((rectangle) => {
															const geometry = getRectangleSpotlightGeometry(
																rectangle,
																overlaySize.width,
																overlaySize.height,
																1,
																annotationViewport,
															);
															if (!geometry) return null;
															return (
																<rect
																	key={rectangle.id}
																	x={geometry.x}
																	y={geometry.y}
																	width={geometry.width}
																	height={geometry.height}
																	rx={geometry.cornerRadius}
																	fill="black"
																	transform={
																		rectangle.rotation
																			? `rotate(${rectangle.rotation} ${geometry.x + geometry.width / 2} ${geometry.y + geometry.height / 2})`
																			: undefined
																	}
																/>
															);
														})}
													</mask>
												</defs>
												<rect
													width="100%"
													height="100%"
													fill={RECTANGLE_SPOTLIGHT_DIM_COLOR}
													mask={`url(#${spotlightMaskId})`}
												/>
											</svg>
										)}
										<div
											className="absolute"
											style={{
												left: annotationViewport.x,
												top: annotationViewport.y,
												width: annotationViewport.width,
												height: annotationViewport.height,
												pointerEvents: "none",
												zIndex: 1,
											}}
										>
											{sorted
												.filter((item) => !isBlankSlide && !isCanvasAnchoredAnnotation(item.region))
												.map((item) => (
													<AnnotationOverlay
														key={
															item.kind === "blur"
																? `${item.region.id}-${annotationViewport.width}-${annotationViewport.height}-${item.region.blurData?.type ?? "blur"}-${item.region.blurData?.shape ?? "rectangle"}-${item.region.blurData?.color ?? "white"}-${Math.round(item.region.blurData?.blockSize ?? 0)}-${Math.round(item.region.blurData?.intensity ?? 0)}-${(item.region.blurData?.freehandPoints ?? []).map((p) => `${Math.round(p.x)}_${Math.round(p.y)}`).join("-")}`
																: `${item.region.id}-${annotationViewport.width}-${annotationViewport.height}`
														}
														annotation={item.region}
														isSelected={
															item.kind === "blur"
																? item.region.id === selectedBlurId
																: item.region.id === selectedAnnotationId
														}
														containerWidth={annotationViewport.width}
														containerHeight={annotationViewport.height}
														onSnapDrag={(rect, bypass, bounds) => {
															const result = snapCanvasDrag(
																{
																	...rect,
																	x: rect.x + annotationViewport.x,
																	y: rect.y + annotationViewport.y,
																},
																bypass,
																bounds
																	? {
																			minX: bounds.minX + annotationViewport.x,
																			maxX: bounds.maxX + annotationViewport.x,
																			minY: bounds.minY + annotationViewport.y,
																			maxY: bounds.maxY + annotationViewport.y,
																		}
																	: undefined,
															);
															return {
																x: result.x - annotationViewport.x,
																y: result.y - annotationViewport.y,
															};
														}}
														onSnapEnd={clearSnapGuides}
														onPositionChange={(id, position) =>
															item.kind === "blur"
																? onBlurPositionChange?.(id, position)
																: onAnnotationPositionChange?.(id, position)
														}
														onSizeChange={(id, size) =>
															item.kind === "blur"
																? onBlurSizeChange?.(id, size)
																: onAnnotationSizeChange?.(id, size)
														}
														onRotationChange={(id, rotation) =>
															onAnnotationRotationChange?.(id, rotation)
														}
														onFigureDataChange={
															item.kind === "annotation"
																? (id, figureData) => onAnnotationFigureDataChange?.(id, figureData)
																: undefined
														}
														onFigureDataCommit={
															item.kind === "annotation" ? onAnnotationFigureDataCommit : undefined
														}
														onBlurDataChange={
															item.kind === "blur"
																? (id, blurData) => onBlurDataChange?.(id, blurData)
																: undefined
														}
														onBlurDataCommit={item.kind === "blur" ? onBlurDataCommit : undefined}
														onPenDataChange={
															item.region.type === "pen"
																? (id, penData) => onPenDataChange?.(id, penData)
																: undefined
														}
														onPenDataCommit={
															item.region.type === "pen" ? onPenDataCommit : undefined
														}
														onClick={item.kind === "blur" ? handleBlurClick : handleAnnotationClick}
														zIndex={
															item.region.type === "text"
																? Math.max(item.region.zIndex, highestRectangleZ + 2000)
																: item.region.zIndex
														}
														isSelectedBoost={
															item.kind === "blur"
																? item.region.id === selectedBlurId
																: item.region.id === selectedAnnotationId
														}
														previewSourceCanvas={previewSnapshotCanvas}
														previewSourceSpace={{
															width: annotationViewport.width,
															height: annotationViewport.height,
															offsetX: 0,
															offsetY: 0,
														}}
														previewFrameVersion={Math.round(currentTime * 1000)}
														currentTimeMs={Math.round(currentTime * 1000)}
													/>
												))}
										</div>
										{canvasAnnotations.length > 0 && (
											<div
												className="absolute inset-0"
												style={{
													pointerEvents: "none",
													zIndex: 50_000,
													opacity: isBlankSlide ? blankSlidePresentation?.opacity : undefined,
													transform: isBlankSlide ? slideTransform : undefined,
													transformOrigin: "center center",
													willChange: isBlankSlide ? "transform, opacity" : undefined,
												}}
											>
												{canvasAnnotations.map((annotation) => (
													<AnnotationOverlay
														key={`${annotation.id}-${overlaySize.width}-${overlaySize.height}`}
														annotation={annotation}
														isSelected={annotation.id === selectedAnnotationId}
														containerWidth={overlaySize.width}
														containerHeight={overlaySize.height}
														onSnapDrag={snapCanvasDrag}
														onSnapEnd={clearSnapGuides}
														onPositionChange={(id, position) =>
															onAnnotationPositionChange?.(id, position)
														}
														onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
														onRotationChange={(id, rotation) =>
															onAnnotationRotationChange?.(id, rotation)
														}
														onFigureDataChange={(id, figureData) =>
															onAnnotationFigureDataChange?.(id, figureData)
														}
														onFigureDataCommit={onAnnotationFigureDataCommit}
														onPenDataChange={
															annotation.type === "pen"
																? (id, penData) => onPenDataChange?.(id, penData)
																: undefined
														}
														onPenDataCommit={
															annotation.type === "pen" ? onPenDataCommit : undefined
														}
														onClick={handleAnnotationClick}
														zIndex={
															annotation.type === "text"
																? Math.max(annotation.zIndex, highestRectangleZ + 2000)
																: annotation.zIndex
														}
														isSelectedBoost={annotation.id === selectedAnnotationId}
														currentTimeMs={Math.round(currentTime * 1000)}
													/>
												))}
											</div>
										)}
									</>
								);
							})()}
							<div
								className="absolute inset-0"
								style={{
									zIndex: 20,
									opacity: blankSlidePresentation ? 1 - blankSlidePresentation.opacity : 1,
									// Keep the full-canvas supplemental-video layer transparent to pointer
									// input. Each actual video component opts back into pointer events, so
									// empty space can reach video-anchored rectangles, arrows, and images.
									pointerEvents: "none",
								}}
							>
								{videoRegions.map((region) => (
									<VideoComponentOverlay
										key={region.id}
										region={region}
										playbackRate={getTimelinePlaybackRate(speedRegions, currentTime)}
										containerWidth={overlaySize.width}
										containerHeight={overlaySize.height}
										onSnapDrag={snapCanvasDrag}
										onSnapEnd={clearSnapGuides}
										currentTime={currentTime}
										isPlaying={isPlaying}
										blankSlideRegions={blankSlideRegions}
										isSelected={region.id === selectedVideoRegionId}
										onSelect={(id) => {
											setIsMainVideoSelected(false);
											onSelectAnnotation?.(null);
											onSelectBlur?.(null);
											onSelectVideoRegion?.(id);
										}}
										onGeometryChange={(id, patch) => onVideoRegionGeometryChange?.(id, patch)}
										onDelete={(id) => onVideoRegionDelete?.(id)}
									/>
								))}
							</div>
							{!isBlankSlide && isMainVideoSelected && canTransformMainVideo && mainVideoLayout && (
								<div
									aria-label="Main video selected"
									className="absolute border-2 border-[#34B27B] shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
									style={{
										left: mainVideoLayout.x,
										top: mainVideoLayout.y,
										width: mainVideoLayout.width,
										height: mainVideoLayout.height,
										zIndex: 100_000,
										pointerEvents: "none",
									}}
								>
									<div className="absolute left-2 top-2 rounded bg-[#34B27B] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow">
										Video {Math.round(videoScale * 100)}%
									</div>
									{(
										[
											{
												x: -1,
												y: -1,
												left: 0,
												top: 0,
												cursor: "nwse-resize",
											},
											{
												x: 1,
												y: -1,
												left: "100%",
												top: 0,
												cursor: "nesw-resize",
											},
											{
												x: -1,
												y: 1,
												left: 0,
												top: "100%",
												cursor: "nesw-resize",
											},
											{
												x: 1,
												y: 1,
												left: "100%",
												top: "100%",
												cursor: "nwse-resize",
											},
										] as const
									).map((handle) => (
										<button
											key={`${handle.x}:${handle.y}`}
											type="button"
											aria-label="Resize main video"
											className="absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#34B27B] shadow-md"
											style={{
												left: handle.left,
												top: handle.top,
												transform: "translate(-50%, -50%)",
												cursor: handle.cursor,
												pointerEvents: "auto",
											}}
											onPointerDown={(event) =>
												handleMainVideoResizeStart(event, handle.x, handle.y)
											}
											onPointerMove={handleMainVideoResizeMove}
											onPointerUp={handleMainVideoResizeEnd}
											onPointerCancel={handleMainVideoResizeEnd}
										/>
									))}
								</div>
							)}
						</div>
					)}
					<CanvasSnapGuides
						guides={snapGuides}
						width={overlaySize.width}
						height={overlaySize.height}
					/>
				</div>
				{/* Native cursor clip. Lives outside composite3DRef (preserve-3d) so clip-path
				    keeps working during 3D zoom rotations; bounds are set dynamically. */}
				<div
					ref={nativeCursorClipRef}
					className="absolute inset-0"
					style={{
						zIndex: 31,
						pointerEvents: "none",
						opacity: blankSlidePresentation ? 1 - blankSlidePresentation.opacity : 1,
					}}
				>
					<div
						ref={nativeCursorHighlightRef}
						aria-hidden="true"
						className="absolute left-0 top-0 rounded-full"
						style={{
							display: "none",
							background: CURSOR_HIGHLIGHT_FILL,
							borderColor: CURSOR_HIGHLIGHT_BORDER,
							borderStyle: "solid",
							boxSizing: "border-box",
							pointerEvents: "none",
							transformOrigin: "0 0",
						}}
					/>
					<img
						ref={nativeCursorImageRef}
						alt=""
						aria-hidden="true"
						className="absolute left-0 top-0 select-none"
						style={{
							display: "none",
							pointerEvents: "none",
							transformOrigin: "0 0",
						}}
					/>
				</div>
				<video
					ref={videoRef}
					src={videoPath}
					className="hidden"
					preload="auto"
					playsInline
					onLoadedMetadata={handleLoadedMetadata}
					onDurationChange={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onLoadedData={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onCanPlay={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onError={() => onError("Failed to load video")}
				/>
				{supplementalAudioPath && (
					<audio ref={supplementalAudioRef} src={supplementalAudioPath} preload="auto" />
				)}
			</div>
		);
	},
);

VideoPlayback.displayName = "VideoPlayback";

export default VideoPlayback;
