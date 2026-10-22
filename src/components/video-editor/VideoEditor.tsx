import type { Span } from "dnd-timeline";
import { FolderOpen, Image as ImageIcon, Languages, ListChecks, Save, Video } from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import type { GuideSession } from "@/guide/contracts";
import {
	buildGuideVideoAnnotations,
	buildGuideVideoSpeedRegions,
	replaceGuideVideoAnnotations,
	replaceGuideVideoSpeedRegions,
} from "@/guide/videoAnnotations";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { type Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import { DEFAULT_SLIDE_TRANSITION_DURATION_MS } from "@/lib/blankSlides";
import {
	captionSegmentsToAnnotationRegions,
	extractMono16kFromVideoUrl,
	MAX_CAPTION_AUDIO_SEC,
	reconcileAutoCaptionTimelineGaps,
	shiftTrimRegionsMsForCaptionBuffer,
	transcribeMono16kToSegments,
	trimLeadingSilenceMono16k,
} from "@/lib/captioning";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import {
	applyVideoOnlyFraming,
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	resolveExportAspectRatio,
	VideoExporter,
} from "@/lib/exporter";
import { computeFrameStepTime } from "@/lib/frameStep";
import { insertedTimelineDurationMs } from "@/lib/insertedSlideTiming";
import type { McpControlResult, McpExportVideoPayload } from "@/lib/mcpControl";
import { normalizeMediaClipTiming } from "@/lib/mediaClipTiming";
import type { CursorCaptureMode, ProjectMedia } from "@/lib/recordingSession";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	clipContentTimeMs,
	clipTimelineView,
	resizeClipWithSlides,
	splitClipWithSlides,
} from "@/lib/slideAwareMediaClip";
import {
	getExportFolder,
	getProjectFolder,
	loadUserPreferences,
	parentDirectoryOf,
	saveUserPreferences,
} from "@/lib/userPreferences";
import { resizeVideoRegionToAspectRatio } from "@/lib/videoRegionLayout";
import { resolveVideoTransformAtTime } from "@/lib/videoTransformKeyframes";
import { BackgroundLoadError, saveCustomBackground } from "@/lib/wallpaper";
import { nativeBridgeClient, useCursorRecordingData, useCursorTelemetry } from "@/native";
import type { NativePlatform } from "@/native/contracts";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import AudioTrackPreview from "./AudioTrackPreview";
import { BACKGROUND_IMAGE_ACCEPT, isSupportedBackgroundImageType } from "./backgroundImageUpload";
import { EditorEmptyState } from "./EditorEmptyState";
import { ExportDialog } from "./ExportDialog";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import { GuidePanel } from "./guide/GuidePanel";
import { getImageAnnotationTimeRange, loadImageAnnotationSize } from "./imageAnnotation";
import type { MediaClipPatch } from "./MediaClipSettingsPanel";
import PlaybackControls from "./PlaybackControls";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import { isAnnotationTrackKind, laneForAnnotation } from "./timeline/annotationTracks";
import TimelineEditor from "./timeline/TimelineEditor";
import { buildAutoZoomSuggestions } from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationOrder,
	type AnnotationRegion,
	type AudioRegion,
	type BlankSlideRegion,
	type BlurData,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_DATA,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PEN_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_RECTANGLE_FIGURE_DATA,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PenData,
	type PlaybackSpeed,
	type Rotation3DPreset,
	type SpeedRegion,
	type TrimRegion,
	type VideoRegion,
	type VideoRegionAspectRatio,
	type VideoTransformKeyframe,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "./types";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";

/** Single Sonner slot so auto-caption phases update in place instead of stacking. */
const AUTO_CAPTION_PROGRESS_TOAST_ID = "auto-caption-progress";

function isClickInteractionType(interactionType: string | null | undefined) {
	return (
		interactionType === "click" ||
		interactionType === "double-click" ||
		interactionType === "right-click" ||
		interactionType === "middle-click"
	);
}

interface ExportDiagnostics {
	formatLabel: "GIF" | "Video";
	reason?: string;
	sourcePath?: string | null;
	width?: number;
	height?: number;
	frameRate?: number;
	codec?: string;
	bitrate?: number;
}

function getFileNameForDiagnostics(filePath?: string | null) {
	if (!filePath) return "unknown";

	try {
		const url = new URL(filePath);
		if (url.protocol === "file:") {
			return decodeURIComponent(url.pathname).split(/[\\/]/).pop() || filePath;
		}
	} catch {
		// Treat non-URL values as filesystem paths.
	}

	return filePath.split(/[\\/]/).pop() || filePath;
}

function buildExportDiagnosticMessage(diagnostics: ExportDiagnostics) {
	const details = [
		diagnostics.reason ? `Reason: ${diagnostics.reason}` : null,
		`Source: ${getFileNameForDiagnostics(diagnostics.sourcePath)}`,
		diagnostics.width && diagnostics.height
			? `Output: ${diagnostics.width}x${diagnostics.height}${
					diagnostics.frameRate ? ` @ ${diagnostics.frameRate} fps` : ""
				}`
			: null,
		diagnostics.codec ? `Codec: ${diagnostics.codec}` : null,
		diagnostics.bitrate ? `Bitrate: ${Math.round(diagnostics.bitrate / 1_000_000)} Mbps` : null,
		`VideoEncoder: ${"VideoEncoder" in window ? "available" : "unavailable"}`,
	].filter(Boolean);

	return `${diagnostics.formatLabel} export failed\n${details.join("\n")}`;
}

function buildSaveDiagnosticMessage(formatLabel: "GIF" | "Video", reason?: string) {
	return `${formatLabel} export save failed${reason ? `\nReason: ${reason}` : ""}`;
}

const CAPTION_WORD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function loadAudioDuration(sourceUrl: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const audio = document.createElement("audio");
		const timeout = window.setTimeout(() => {
			cleanup();
			reject(new Error("Timed out while reading the audio file"));
		}, 15_000);
		const cleanup = () => {
			window.clearTimeout(timeout);
			audio.removeEventListener("loadedmetadata", onLoaded);
			audio.removeEventListener("error", onError);
			audio.src = "";
		};
		const onLoaded = () => {
			const audioDuration = audio.duration;
			cleanup();
			if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
				reject(new Error("The selected audio file has no readable duration"));
				return;
			}
			resolve(audioDuration);
		};
		const onError = () => {
			cleanup();
			reject(new Error("The selected audio file could not be loaded"));
		};
		audio.addEventListener("loadedmetadata", onLoaded, { once: true });
		audio.addEventListener("error", onError, { once: true });
		audio.preload = "metadata";
		audio.src = sourceUrl;
		audio.load();
	});
}

function loadVideoComponentMetadata(sourceUrl: string) {
	return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
		const video = document.createElement("video");
		const cleanup = () => {
			video.removeAttribute("src");
			video.load();
		};
		video.addEventListener(
			"loadedmetadata",
			() => {
				const duration = video.duration;
				const width = video.videoWidth;
				const height = video.videoHeight;
				cleanup();
				if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) {
					reject(new Error("The selected video has invalid metadata"));
					return;
				}
				resolve({ duration, width, height });
			},
			{ once: true },
		);
		video.addEventListener(
			"error",
			() => {
				cleanup();
				reject(new Error("The selected video could not be loaded"));
			},
			{ once: true },
		);
		video.muted = true;
		video.preload = "metadata";
		video.src = sourceUrl;
		video.load();
	});
}

export default function VideoEditor() {
	const {
		state: editorState,
		pushState,
		updateState,
		commitState,
		undo,
		redo,
		resetState,
	} = useEditorHistory(INITIAL_EDITOR_STATE);

	const {
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		blankSlideRegions,
		videoRegions,
		cropRegion,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		videoPosition,
		videoScale,
		videoTransformKeyframes,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
	} = editorState;

	// Non-undoable state
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [sourceDuration, setDuration] = useState(0);
	const duration = insertedTimelineDurationMs(sourceDuration * 1000, blankSlideRegions) / 1000;
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const videoTransformKeyframesRef = useRef(videoTransformKeyframes);
	videoTransformKeyframesRef.current = videoTransformKeyframes;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const resolvedVideoTransform = useMemo(
		() =>
			resolveVideoTransformAtTime(
				videoTransformKeyframes,
				Math.round(currentTime * 1000),
				videoPosition,
				videoScale,
			),
		[currentTime, videoPosition, videoScale, videoTransformKeyframes],
	);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [isPreviewingZoom, setIsPreviewingZoom] = useState(false);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [selectedBlankSlideId, setSelectedBlankSlideId] = useState<string | null>(null);
	const [selectedVideoRegionId, setSelectedVideoRegionId] = useState<string | null>(null);
	const [selectedVideoTransformKeyframeId, setSelectedVideoTransformKeyframeId] = useState<
		string | null
	>(null);
	const [isDraggingPlayerFile, setIsDraggingPlayerFile] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [isExportingKdenlive, setIsExportingKdenlive] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_SETTINGS.quality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
	const [exportVideoOnly, setExportVideoOnly] = useState(false);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(DEFAULT_GIF_SETTINGS.frameRate);
	const [gifLoop, setGifLoop] = useState(DEFAULT_GIF_SETTINGS.loop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		DEFAULT_GIF_SETTINGS.sizePreset,
	);
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
	// Unsaved-changes confirmation for New Project / Load Project.
	// The window-close flow uses showCloseConfirmDialog above.
	const [confirmDialogVariant, setConfirmDialogVariant] = useState<
		"newProject" | "loadProject" | null
	>(null);
	const playerContainerRef = useRef<HTMLDivElement | null>(null);
	const shortcutImageInputRef = useRef<HTMLInputElement | null>(null);
	const cursorTelemetrySourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
	const { samples: cursorTelemetry, error: cursorTelemetryError } =
		useCursorTelemetry(cursorTelemetrySourcePath);
	const { data: cursorRecordingData, error: cursorRecordingDataError } =
		useCursorRecordingData(cursorTelemetrySourcePath);
	const cursorClickTimestamps = useMemo<number[]>(() => {
		const recordingClicks =
			cursorRecordingData?.samples
				.filter((sample) => isClickInteractionType(sample.interactionType))
				.map((sample) => sample.timeMs) ?? [];
		if (recordingClicks.length > 0) {
			return recordingClicks;
		}

		return cursorTelemetry
			.filter((sample) => isClickInteractionType(sample.interactionType))
			.map((sample) => sample.timeMs);
	}, [cursorRecordingData, cursorTelemetry]);

	// Cursor & motion blur visual settings (non-undoable preferences)
	const [showCursor, setShowCursor] = useState(DEFAULT_CURSOR_SETTINGS.show);
	const [cursorSize, setCursorSize] = useState(DEFAULT_CURSOR_SETTINGS.size);
	const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SETTINGS.smoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(DEFAULT_CURSOR_SETTINGS.motionBlur);
	const [cursorClickBounce, setCursorClickBounce] = useState(DEFAULT_CURSOR_SETTINGS.clickBounce);
	const [cursorClipToBounds, setCursorClipToBounds] = useState(
		DEFAULT_CURSOR_SETTINGS.clipToBounds,
	);
	const [cursorTheme, setCursorTheme] = useState(DEFAULT_CURSOR_SETTINGS.theme);
	const [cursorHighlight, setCursorHighlight] = useState(DEFAULT_CURSOR_SETTINGS.highlight);
	const [cursorHighlightSize, setCursorHighlightSize] = useState(
		DEFAULT_CURSOR_SETTINGS.highlightSize,
	);
	const [nativePlatform, setNativePlatform] = useState<NativePlatform | null>(null);
	const [recordingCursorCaptureMode, setRecordingCursorCaptureMode] =
		useState<CursorCaptureMode | null>(null);

	const [guideRecordingId, setGuideRecordingId] = useState<number | null>(null);
	const [isGuidePanelVisible, setIsGuidePanelVisible] = useState(false);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);
	const nextAudioIdRef = useRef(1);
	const nextBlankSlideIdRef = useRef(1);
	const nextVideoRegionIdRef = useRef(1);
	const nextVideoTransformKeyframeIdRef = useRef(1);
	const nextVideoRegionZIndexRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	// Windows recordings include captured cursor assets. macOS hides the system
	// cursor in ScreenCaptureKit and renders telemetry samples with OpenScreen's
	// default arrow asset for the editable overlay.
	const hasEditableCursorRecording =
		recordingCursorCaptureMode === "editable-overlay" &&
		(nativePlatform === "win32" || nativePlatform === "darwin") &&
		hasNativeCursorRecordingData(cursorRecordingData);
	const effectiveShowCursor = showCursor && hasEditableCursorRecording;
	const showCursorSettings = hasEditableCursorRecording;
	const { locale, setLocale, t: rawT } = useI18n();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const availableLocales = getAvailableLocales();

	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1);
	const isAutoCaptioningRef = useRef(false);
	const [isAutoCaptioning, setIsAutoCaptioning] = useState(false);
	const [showAutoCaptionsDialog, setShowAutoCaptionsDialog] = useState(false);
	const [captionWordsMin, setCaptionWordsMin] = useState(2);
	const [captionWordsMax, setCaptionWordsMax] = useState(7);
	const exporterRef = useRef<VideoExporter | null>(null);

	const annotationOnlyRegions = useMemo(
		() => annotationRegions.filter((region) => region.type !== "blur"),
		[annotationRegions],
	);
	const blurRegions = useMemo(
		() => annotationRegions.filter((region) => region.type === "blur"),
		[annotationRegions],
	);
	const previewVideoRegions = useMemo(
		() => videoRegions.map((region) => ({ ...region, previewUrl: toFileUrl(region.sourcePath) })),
		[videoRegions],
	);
	const timelineVideoRegions = useMemo(
		() => videoRegions.map((region) => clipTimelineView(region, blankSlideRegions)),
		[videoRegions, blankSlideRegions],
	);
	const timelineAudioRegions = useMemo(
		() => audioRegions.map((region) => clipTimelineView(region, blankSlideRegions)),
		[audioRegions, blankSlideRegions],
	);
	const selectedAudioRegion = audioRegions.find((region) => region.id === selectedAudioId) ?? null;
	const selectedVideoRegion = useMemo(
		() => videoRegions.find((region) => region.id === selectedVideoRegionId) ?? null,
		[selectedVideoRegionId, videoRegions],
	);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return {
			screenVideoPath,
			...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
			...(recordingCursorCaptureMode ? { cursorCaptureMode: recordingCursorCaptureMode } : {}),
		};
	}, [
		videoPath,
		videoSourcePath,
		webcamVideoPath,
		webcamVideoSourcePath,
		recordingCursorCaptureMode,
	]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const projectMedia = resolveProjectMedia(project);
			if (!projectMedia) {
				return false;
			}
			const sourcePath = projectMedia.screenVideoPath;
			const webcamSourcePath = projectMedia.webcamVideoPath ?? null;
			const projectCursorCaptureMode = projectMedia.cursorCaptureMode ?? null;
			const normalizedEditor = normalizeProjectEditor(project.editor);
			const inferredDurationMs = Math.max(
				0,
				...normalizedEditor.zoomRegions.map((region) => region.endMs),
				...normalizedEditor.trimRegions.map((region) => region.endMs),
				...normalizedEditor.speedRegions.map((region) => region.endMs),
				...normalizedEditor.annotationRegions.map((region) => region.endMs),
				...normalizedEditor.videoRegions.map((region) => region.endMs),
				...normalizedEditor.blankSlideRegions.map((region) => region.endMs),
				...normalizedEditor.videoTransformKeyframes.map((keyframe) => keyframe.timeMs),
			);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(inferredDurationMs > 0 ? inferredDurationMs / 1000 : 0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
			setRecordingCursorCaptureMode(projectCursorCaptureMode);
			setGuideRecordingId(null);
			setIsGuidePanelVisible(false);
			setCurrentProjectPath(path ?? null);

			// A loaded project keeps its zooms exactly as saved, so never auto-suggest
			// over it (even if it has zero zooms because the user deleted them all).
			autoProcessedSourceRef.current = sourcePath;

			pushState({
				wallpaper: normalizedEditor.wallpaper,
				shadowIntensity: normalizedEditor.shadowIntensity,
				showBlur: normalizedEditor.showBlur,
				showTrimWaveform: normalizedEditor.showTrimWaveform,
				motionBlurAmount: normalizedEditor.motionBlurAmount,
				borderRadius: normalizedEditor.borderRadius,
				padding: normalizedEditor.padding,
				videoPosition: normalizedEditor.videoPosition,
				videoScale: normalizedEditor.videoScale,
				videoTransformKeyframes: normalizedEditor.videoTransformKeyframes,
				cropRegion: normalizedEditor.cropRegion,
				zoomRegions: normalizedEditor.zoomRegions,
				autoZoomEnabled: normalizedEditor.autoZoomEnabled,
				autoFocusAll: normalizedEditor.autoFocusAll,
				trimRegions: normalizedEditor.trimRegions,
				speedRegions: normalizedEditor.speedRegions,
				annotationRegions: normalizedEditor.annotationRegions,
				audioRegions: normalizedEditor.audioRegions,
				blankSlideRegions: normalizedEditor.blankSlideRegions,
				videoRegions: normalizedEditor.videoRegions,
				aspectRatio: normalizedEditor.aspectRatio,
				webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
				webcamMaskShape: normalizedEditor.webcamMaskShape,
				webcamMirrored: normalizedEditor.webcamMirrored,
				webcamReactiveZoom: normalizedEditor.webcamReactiveZoom,
				webcamSizePreset: normalizedEditor.webcamSizePreset,
				webcamPosition: normalizedEditor.webcamPosition,
			});
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);
			setCursorTheme(normalizedEditor.cursorTheme);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedBlankSlideId(null);
			setSelectedVideoRegionId(null);
			setSelectedVideoTransformKeyframeId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				normalizedEditor.audioRegions.map((region) => region.id),
			);
			nextBlankSlideIdRef.current = deriveNextId(
				"blank-slide",
				normalizedEditor.blankSlideRegions.map((region) => region.id),
			);
			nextVideoRegionIdRef.current = deriveNextId(
				"video-component",
				normalizedEditor.videoRegions.map((region) => region.id),
			);
			nextVideoTransformKeyframeIdRef.current = deriveNextId(
				"video-keyframe",
				normalizedEditor.videoTransformKeyframes.map((keyframe) => keyframe.id),
			);
			nextVideoRegionZIndexRef.current =
				normalizedEditor.videoRegions.reduce(
					(maximum, region) => Math.max(maximum, region.zIndex),
					0,
				) + 1;
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			setLastSavedSnapshot(
				createProjectSnapshot(
					{
						screenVideoPath: sourcePath,
						...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
						...(projectCursorCaptureMode ? { cursorCaptureMode: projectCursorCaptureMode } : {}),
					},
					normalizedEditor,
				),
			);
			return true;
		},
		[pushState],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			videoPosition,
			videoScale,
			videoTransformKeyframes,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			blankSlideRegions,
			videoRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
		});
	}, [
		currentProjectMedia,
		cursorTheme,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		videoPosition,
		videoScale,
		videoTransformKeyframes,
		cropRegion,
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		blankSlideRegions,
		videoRegions,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);
	const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
	hasUnsavedChangesRef.current = hasUnsavedChanges;

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await nativeBridgeClient.project.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const currentSessionResult = await window.electronAPI.getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
					setRecordingCursorCaptureMode(session.cursorCaptureMode ?? null);
					setGuideRecordingId(session.createdAt);
					setIsGuidePanelVisible(false);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							{
								screenVideoPath: sourcePath,
								...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
								...(session.cursorCaptureMode
									? { cursorCaptureMode: session.cursorCaptureMode }
									: {}),
							},
							INITIAL_EDITOR_STATE,
						),
					);
					return;
				}

				const result = await nativeBridgeClient.project.getCurrentVideoPath();
				if (result.success && result.path) {
					setVideoSourcePath(result.path);
					setVideoPath(toFileUrl(result.path));
					setRecordingCursorCaptureMode(null);
					setGuideRecordingId(null);
					setIsGuidePanelVisible(false);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: result.path }, INITIAL_EDITOR_STATE),
					);
				}
				// No video/project/session, so leave videoPath null and let the
				// EditorEmptyState dashboard render instead of an error screen.
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// Avoid overwriting saved prefs with defaults before they've loaded.
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	// Load persisted user preferences on mount (intentionally runs once)
	useEffect(() => {
		const prefs = loadUserPreferences();
		updateState({
			padding: prefs.padding,
			aspectRatio: prefs.aspectRatio,
		});
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
		setExportVideoOnly(prefs.exportVideoOnly);
		setPrefsHydrated(true);
	}, [updateState]);

	// Auto-save user preferences when settings change
	useEffect(() => {
		if (!prefsHydrated) return;
		saveUserPreferences({
			padding,
			aspectRatio,
			exportQuality,
			exportFormat,
			exportVideoOnly,
		});
	}, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat, exportVideoOnly]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			const editorState = {
				wallpaper,
				shadowIntensity,
				showBlur,
				showTrimWaveform,
				motionBlurAmount,
				borderRadius,
				padding,
				videoPosition,
				videoScale,
				videoTransformKeyframes,
				cropRegion,
				zoomRegions,
				autoZoomEnabled,
				autoFocusAll,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioRegions,
				blankSlideRegions,
				videoRegions,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamMirrored,
				webcamReactiveZoom,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				cursorTheme,
			};
			const projectData = createProjectData(currentProjectMedia, editorState);

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			// Normalize the same way as currentProjectSnapshot so the post-save
			// baseline compares equal and hasUnsavedChanges clears.
			const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
			const result = await nativeBridgeClient.project.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			videoPosition,
			videoScale,
			videoTransformKeyframes,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			blankSlideRegions,
			videoRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
			videoPath,
			t,
		],
	);

	useLayoutEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useLayoutEffect(() => {
		const cleanup = window.electronAPI.onRequestCloseState(() => hasUnsavedChangesRef.current);
		return () => cleanup();
	}, []);

	useLayoutEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	useLayoutEffect(() => {
		const cleanup = window.electronAPI.onRequestCloseConfirm(() => {
			setShowCloseConfirmDialog(true);
		});
		return () => cleanup();
	}, []);

	useLayoutEffect(() => {
		const cleanup = window.electronAPI.onCancelCloseConfirm(() => {
			setShowCloseConfirmDialog(false);
		});
		return () => cleanup();
	}, []);

	const handleCloseConfirmSave = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("save");
	}, []);

	const handleCloseConfirmDiscard = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("discard");
	}, []);

	const handleCloseConfirmCancel = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("cancel");
	}, []);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await window.electronAPI.startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
	}, []);

	const doLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || t("project.failedToLoad"));
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error(t("project.invalidFormat"));
			return;
		}

		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}

		toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
	}, [applyLoadedProject, t]);

	const handleLoadProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("loadProject");
			return;
		}
		await doLoadProject();
	}, [hasUnsavedChanges, doLoadProject]);

	const handleLoadProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doLoadProject();
		}
	}, [saveProject, doLoadProject]);

	const handleLoadProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doLoadProject();
	}, [doLoadProject]);

	// New Project: clear all media/project/editor state back to the empty
	// Studio dashboard. Prompts to save first when there are unsaved changes.
	const doNewProject = useCallback(async () => {
		await nativeBridgeClient.project.clearCurrentVideoPath();
		setVideoPath(null);
		setVideoSourcePath(null);
		setWebcamVideoPath(null);
		setWebcamVideoSourcePath(null);
		setCurrentProjectPath(null);
		setLastSavedSnapshot(null);
		// Reset undoable editor state + undo/redo history to a clean slate.
		resetState();
		// Reset non-undoable selection state.
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedBlurId(null);
		setSelectedVideoTransformKeyframeId(null);
		// Reset playback.
		setCurrentTime(0);
		setIsPlaying(false);
		// Reset cursor preferences to defaults.
		setShowCursor(DEFAULT_CURSOR_SETTINGS.show);
		setCursorSize(DEFAULT_CURSOR_SETTINGS.size);
		setCursorSmoothing(DEFAULT_CURSOR_SETTINGS.smoothing);
		setCursorMotionBlur(DEFAULT_CURSOR_SETTINGS.motionBlur);
		setCursorClickBounce(DEFAULT_CURSOR_SETTINGS.clickBounce);
		setCursorClipToBounds(DEFAULT_CURSOR_SETTINGS.clipToBounds);
		setCursorTheme(DEFAULT_CURSOR_SETTINGS.theme);
		// Reset region ID counters.
		nextZoomIdRef.current = 1;
		nextTrimIdRef.current = 1;
		nextSpeedIdRef.current = 1;
		nextAnnotationIdRef.current = 1;
		nextVideoTransformKeyframeIdRef.current = 1;
		nextAnnotationZIndexRef.current = 1;
	}, [resetState]);

	const handleNewProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("newProject");
			return;
		}
		await doNewProject();
	}, [hasUnsavedChanges, doNewProject]);
	void handleNewProject;

	const handleNewProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doNewProject();
		}
	}, [saveProject, doNewProject]);

	const handleNewProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doNewProject();
	}, [doNewProject]);

	useEffect(() => {
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let canceled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!canceled) {
					setNativePlatform(platform);
				}
			})
			.catch((error) => {
				console.warn("Unable to resolve native platform for cursor settings:", error);
				if (!canceled) {
					setNativePlatform(null);
				}
			});

		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		if (cursorTelemetryError) {
			console.warn("Unable to load cursor telemetry:", cursorTelemetryError);
		}
	}, [cursorTelemetryError]);

	useEffect(() => {
		if (cursorRecordingDataError) {
			console.warn("Unable to load cursor recording data:", cursorRecordingDataError);
		}
	}, [cursorRecordingDataError]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		videoPlaybackRef.current?.seek(time);
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleSelectBlur = useCallback((id: string | null) => {
		setSelectedBlurId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleVideoTransformKeyframeAdded = useCallback(
		(timeMs: number) => {
			const clampedTimeMs = Math.max(
				0,
				Math.min(Math.round(timeMs), Math.round(durationRef.current * 1000)),
			);
			const currentKeyframes = videoTransformKeyframesRef.current;
			const existing = currentKeyframes.find(
				(keyframe) => Math.abs(keyframe.timeMs - clampedTimeMs) < 1,
			);
			if (existing) {
				setSelectedVideoTransformKeyframeId(existing.id);
				return;
			}

			const transform = resolveVideoTransformAtTime(
				currentKeyframes,
				clampedTimeMs,
				videoPosition,
				videoScale,
			);
			const keyframe: VideoTransformKeyframe = {
				id: `video-keyframe-${nextVideoTransformKeyframeIdRef.current++}`,
				timeMs: clampedTimeMs,
				position: transform.position,
				scale: transform.scale,
			};
			const nextKeyframes = [...currentKeyframes, keyframe].sort(
				(left, right) => left.timeMs - right.timeMs,
			);
			videoTransformKeyframesRef.current = nextKeyframes;
			pushState({ videoTransformKeyframes: nextKeyframes });
			setSelectedVideoTransformKeyframeId(keyframe.id);
		},
		[pushState, videoPosition, videoScale],
	);

	const handleVideoTransformKeyframeMove = useCallback(
		(id: string, timeMs: number) => {
			const clampedTimeMs = Math.max(
				0,
				Math.min(Math.round(timeMs), Math.round(durationRef.current * 1000)),
			);
			const nextKeyframes = videoTransformKeyframesRef.current
				.map((keyframe) => (keyframe.id === id ? { ...keyframe, timeMs: clampedTimeMs } : keyframe))
				.sort((left, right) => left.timeMs - right.timeMs);
			videoTransformKeyframesRef.current = nextKeyframes;
			updateState({ videoTransformKeyframes: nextKeyframes });
		},
		[updateState],
	);

	const handleVideoTransformKeyframeDelete = useCallback(
		(id: string) => {
			const nextKeyframes = videoTransformKeyframesRef.current.filter(
				(keyframe) => keyframe.id !== id,
			);
			videoTransformKeyframesRef.current = nextKeyframes;
			pushState({ videoTransformKeyframes: nextKeyframes });
			setSelectedVideoTransformKeyframeId((selectedId) => (selectedId === id ? null : selectedId));
		},
		[pushState],
	);

	const updateVideoTransformAtPlayhead = useCallback(
		(patch: Partial<Pick<VideoTransformKeyframe, "position" | "scale">>) => {
			const currentKeyframes = videoTransformKeyframesRef.current;
			if (currentKeyframes.length === 0) {
				updateState({
					...(patch.position !== undefined ? { videoPosition: patch.position } : {}),
					...(patch.scale !== undefined ? { videoScale: patch.scale } : {}),
				});
				return;
			}

			const timeMs = Math.max(
				0,
				Math.min(Math.round(currentTimeRef.current * 1000), Math.round(durationRef.current * 1000)),
			);
			const existing = currentKeyframes.find(
				(keyframe) => Math.abs(keyframe.timeMs - timeMs) <= 50,
			);
			const transform = resolveVideoTransformAtTime(
				currentKeyframes,
				timeMs,
				videoPosition,
				videoScale,
			);
			const keyframe: VideoTransformKeyframe = {
				id: existing?.id ?? `video-keyframe-${nextVideoTransformKeyframeIdRef.current++}`,
				timeMs: existing?.timeMs ?? timeMs,
				position: patch.position !== undefined ? patch.position : transform.position,
				scale: patch.scale !== undefined ? patch.scale : transform.scale,
			};
			const nextKeyframes = existing
				? currentKeyframes.map((item) => (item.id === existing.id ? keyframe : item))
				: [...currentKeyframes, keyframe].sort((left, right) => left.timeMs - right.timeMs);
			videoTransformKeyframesRef.current = nextKeyframes;
			setSelectedVideoTransformKeyframeId(keyframe.id);
			updateState({ videoTransformKeyframes: nextKeyframes });
		},
		[updateState, videoPosition, videoScale],
	);

	const handleVideoPositionChange = useCallback(
		(position: NonNullable<VideoTransformKeyframe["position"]>) => {
			updateVideoTransformAtPlayhead({ position });
		},
		[updateVideoTransformAtPlayhead],
	);

	const handleVideoScaleChange = useCallback(
		(scale: number) => {
			updateVideoTransformAtPlayhead({ scale });
		},
		[updateVideoTransformAtPlayhead],
	);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: { cx: 0.5, cy: 0.5 },
				// Auto-Focus on means new zooms follow the cursor too.
				focusMode: autoFocusAll ? "auto" : undefined,
				source: "manual",
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			setSelectedZoomId(id);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		},
		[pushState, autoFocusAll],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
			};
			// Bulk suggest must not steal selection — keeping a zoom selected hides
			// the export panel (SettingsPanel gates it on !hasTimelineSelection),
			// trapping users who just want to export after auto-zoom.
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
		},
		[pushState],
	);

	// Builds fresh "auto" zoom regions from cursor telemetry without overlapping
	// existing ones. Used by both the on-load auto-suggest pass and the wand toggle.
	const buildAutoZoomRegions = useCallback(
		(existingRegions: ZoomRegion[]): ZoomRegion[] => {
			const totalMs = Math.round(duration * 1000);
			const suggestions = buildAutoZoomSuggestions({
				cursorTelemetry,
				totalMs,
				existingRegions,
				defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
			});
			return suggestions.map((suggestion) => ({
				id: `zoom-${nextZoomIdRef.current++}`,
				startMs: Math.round(suggestion.span.start),
				endMs: Math.round(suggestion.span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: clampFocusToDepth(suggestion.focus, DEFAULT_ZOOM_DEPTH),
				focusMode: autoFocusAll ? ("auto" as const) : undefined,
				source: "auto" as const,
			}));
		},
		[cursorTelemetry, duration, autoFocusAll],
	);

	// Auto-suggest zooms once per fresh recording (no existing zooms, telemetry
	// available, wand enabled). Loaded projects are marked processed elsewhere so
	// they're never touched. The ref guard runs this once per source and survives undo.
	const autoProcessedSourceRef = useRef<string | null>(null);
	useEffect(() => {
		if (!autoZoomEnabled || !cursorTelemetrySourcePath) return;
		if (autoProcessedSourceRef.current === cursorTelemetrySourcePath) return;
		if (cursorTelemetry.length < 2 || duration <= 0) return;
		// Only auto-suggest for a fresh recording; don't disturb existing zooms.
		if (zoomRegions.length > 0) {
			autoProcessedSourceRef.current = cursorTelemetrySourcePath;
			return;
		}
		const newRegions = buildAutoZoomRegions([]);
		autoProcessedSourceRef.current = cursorTelemetrySourcePath;
		if (newRegions.length === 0) return;
		pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, ...newRegions] }));
	}, [
		autoZoomEnabled,
		cursorTelemetrySourcePath,
		cursorTelemetry,
		duration,
		zoomRegions,
		buildAutoZoomRegions,
		pushState,
	]);

	// Wand toggle: ON regenerates suggestions around existing zooms; OFF removes
	// only untouched auto zooms (manual and edited-to-manual survive).
	const handleToggleAutoZoom = useCallback(
		(enabled: boolean) => {
			if (enabled) {
				autoProcessedSourceRef.current = cursorTelemetrySourcePath;
				pushState((prev) => ({
					autoZoomEnabled: true,
					zoomRegions: [...prev.zoomRegions, ...buildAutoZoomRegions(prev.zoomRegions)],
				}));
			} else {
				pushState((prev) => ({
					autoZoomEnabled: false,
					zoomRegions: prev.zoomRegions.filter((region) => region.source !== "auto"),
				}));
			}
		},
		[pushState, buildAutoZoomRegions, cursorTelemetrySourcePath],
	);

	// Flip every zoom between auto (cursor-follow) and manual at once.
	const handleToggleAutoFocusAll = useCallback(
		(on: boolean) => {
			pushState((prev) => ({
				autoFocusAll: on,
				zoomRegions: prev.zoomRegions.map((region) => ({
					...region,
					focusMode: on ? "auto" : "manual",
				})),
			}));
		},
		[pushState],
	);

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextTrimIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			setSelectedTrimId(id);
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
		},
		[pushState],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleTrimSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	// Focus drag: updateState for live preview, commitState on pointer-up.
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? { ...region, focus: clampFocusToDepth(focus, region.depth), source: "manual" }
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								customScale: ZOOM_DEPTH_SCALES[depth],
								focus: clampFocusToDepth(region.focus, depth),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomCustomScaleChange = useCallback(
		(scale: number) => {
			if (!selectedZoomId) return;
			const rounded = Math.round(scale * 100) / 100;
			if (!Number.isFinite(rounded)) return;
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? { ...region, customScale: rounded, source: "manual" }
						: region,
				),
			}));
		},
		[selectedZoomId, updateState],
	);

	const handleZoomCustomScaleCommit = useCallback(() => {
		commitState();
	}, [commitState]);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode, source: "manual" } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
			}));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId, pushState],
	);

	const handleZoomRotationPresetChange = useCallback(
		(preset: Rotation3DPreset | null) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) => {
					if (region.id !== selectedZoomId) return region;
					if (preset === null) {
						const { rotationPreset: _p, ...rest } = region;
						return { ...rest, source: "manual" };
					}
					return { ...region, rotationPreset: preset, source: "manual" };
				}),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId, pushState],
	);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleSelectAudio = useCallback((id: string | null) => {
		setSelectedAudioId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	const handleSelectBlankSlide = useCallback((id: string | null) => {
		setSelectedBlankSlideId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		}
	}, []);

	useEffect(() => {
		if (
			selectedBlankSlideId &&
			(selectedZoomId ||
				selectedTrimId ||
				selectedSpeedId ||
				selectedAnnotationId ||
				selectedBlurId ||
				selectedAudioId ||
				selectedVideoRegionId)
		) {
			setSelectedBlankSlideId(null);
		}
	}, [
		selectedBlankSlideId,
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedBlurId,
		selectedAudioId,
		selectedVideoRegionId,
	]);

	const handleSelectVideoRegion = useCallback((id: string | null) => {
		setSelectedVideoRegionId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextSpeedIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({
				speedRegions: [...prev.speedRegions, newRegion],
			}));
			setSelectedSpeedId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			setSelectedVideoRegionId(null);
		},
		[pushState],
	);

	const handleSpeedSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.filter((region) => region.id !== id),
			}));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId, pushState],
	);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const handleAddVideoComponents = useCallback(async () => {
		if (durationRef.current <= 0) {
			toast.error(ts("videoComponents.noMainVideo"));
			return;
		}

		const result = await window.electronAPI.openVideoComponentsPicker();
		if (result.canceled) return;
		if (!result.success || !result.paths?.length) {
			toast.error(result.message || ts("videoComponents.failedToAdd"));
			return;
		}

		const mainVideo = videoPlaybackRef.current?.video;
		const canvasAspect =
			aspectRatio === "native"
				? getNativeAspectRatioValue(
						mainVideo?.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width,
						mainVideo?.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height,
						cropRegion,
					)
				: getAspectRatioValue(aspectRatio);
		const videoDurationMs = Math.max(1, Math.round(durationRef.current * 1000));
		const playheadMs = Math.max(
			0,
			Math.min(videoDurationMs, Math.round(currentTimeRef.current * 1000)),
		);
		const clipStartMs = playheadMs >= videoDurationMs ? 0 : playheadMs;
		const created: VideoRegion[] = [];

		for (const sourcePath of result.paths) {
			try {
				const metadata = await loadVideoComponentMetadata(toFileUrl(sourcePath));
				const sourceDurationMs = Math.max(1, Math.round(metadata.duration * 1000));
				const width = 36;
				const sourceAspect = metadata.width / metadata.height;
				const height = Math.max(10, Math.min(75, (width * canvasAspect) / sourceAspect));
				const placementIndex = videoRegions.length + created.length;
				created.push({
					id: `video-component-${nextVideoRegionIdRef.current++}`,
					startMs: clipStartMs,
					endMs: Math.min(videoDurationMs, clipStartMs + sourceDurationMs),
					sourcePath,
					name: sourcePath.split(/[\\/]/).pop() || "Video",
					sourceDurationMs,
					sourceStartMs: 0,
					sourceWidth: metadata.width,
					sourceHeight: metadata.height,
					position: {
						x: Math.min(100 - width, 8 + ((placementIndex * 7) % 48)),
						y: Math.min(100 - height, 8 + ((placementIndex * 6) % 42)),
					},
					size: { width, height },
					fitMode: "cover",
					frameAspectRatio: "source",
					cropPosition: { x: 50, y: 50 },
					cropZoom: 1,
					zIndex: nextVideoRegionZIndexRef.current++,
				});
			} catch (metadataError) {
				toast.error(
					metadataError instanceof Error
						? metadataError.message
						: ts("videoComponents.failedToAdd"),
				);
			}
		}

		if (created.length === 0) return;
		pushState((previous) => ({
			videoRegions: [...previous.videoRegions, ...created],
		}));
		handleSelectVideoRegion(created[created.length - 1].id);
		toast.success(ts("videoComponents.added", { count: created.length }));
	}, [aspectRatio, cropRegion, handleSelectVideoRegion, pushState, ts, videoRegions.length]);

	const handleVideoRegionGeometryChange = useCallback(
		(id: string, patch: Partial<Pick<VideoRegion, "position" | "size">>) => {
			pushState((previous) => ({
				videoRegions: previous.videoRegions.map((region) => {
					if (region.id !== id) return region;
					const size = patch.size
						? {
								width: Math.max(5, Math.min(100, patch.size.width)),
								height: Math.max(5, Math.min(100, patch.size.height)),
							}
						: region.size;
					const candidatePosition = patch.position ?? region.position;
					return {
						...region,
						size,
						position: {
							x: Math.max(0, Math.min(100 - size.width, candidatePosition.x)),
							y: Math.max(0, Math.min(100 - size.height, candidatePosition.y)),
						},
					};
				}),
			}));
		},
		[pushState],
	);

	const handleVideoRegionAppearanceChange = useCallback(
		(id: string, patch: Partial<Pick<VideoRegion, "fitMode" | "cropPosition" | "cropZoom">>) => {
			pushState((previous) => ({
				videoRegions: previous.videoRegions.map((region) =>
					region.id === id ? { ...region, ...patch } : region,
				),
			}));
		},
		[pushState],
	);

	const handleVideoRegionAppearancePreview = useCallback(
		(id: string, patch: Partial<Pick<VideoRegion, "fitMode" | "cropPosition" | "cropZoom">>) => {
			updateState((previous) => ({
				videoRegions: previous.videoRegions.map((region) =>
					region.id === id ? { ...region, ...patch } : region,
				),
			}));
		},
		[updateState],
	);

	const handleVideoRegionAspectRatioChange = useCallback(
		(id: string, nextAspectRatio: VideoRegionAspectRatio) => {
			const mainVideo = videoPlaybackRef.current?.video;
			const canvasAspect =
				aspectRatio === "native"
					? getNativeAspectRatioValue(
							mainVideo?.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width,
							mainVideo?.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height,
							cropRegion,
						)
					: getAspectRatioValue(aspectRatio);
			pushState((previous) => ({
				videoRegions: previous.videoRegions.map((region) =>
					region.id === id
						? {
								...region,
								...resizeVideoRegionToAspectRatio(region, nextAspectRatio, canvasAspect),
							}
						: region,
				),
			}));
		},
		[aspectRatio, cropRegion, pushState],
	);

	const handleVideoRegionDelete = useCallback(
		(id: string) => {
			pushState((previous) => ({
				videoRegions: previous.videoRegions.filter((region) => region.id !== id),
			}));
			if (selectedVideoRegionId === id) setSelectedVideoRegionId(null);
		},
		[pushState, selectedVideoRegionId],
	);

	const handleAddAudio = useCallback(async () => {
		if (durationRef.current <= 0) {
			toast.error("No video loaded");
			return;
		}

		const result = await window.electronAPI.openAudioFilePicker();
		if (result.canceled) return;
		if (!result.success || !result.path) {
			toast.error(result.message || "Could not add the audio file");
			return;
		}

		try {
			const sourceDurationSec = await loadAudioDuration(toFileUrl(result.path));
			const videoDurationMs = Math.round(durationRef.current * 1000);
			const sourceDurationMs = Math.max(1, Math.round(sourceDurationSec * 1000));
			let startMs = Math.max(
				0,
				Math.min(Math.round(currentTimeRef.current * 1000), videoDurationMs),
			);
			if (startMs >= videoDurationMs) startMs = 0;
			const endMs = Math.min(videoDurationMs, startMs + sourceDurationMs);

			if (endMs <= startMs) {
				toast.error("There is no room for audio at the current position");
				return;
			}

			const id = `audio-${nextAudioIdRef.current++}`;
			const newRegion: AudioRegion = {
				id,
				startMs,
				endMs,
				sourcePath: result.path,
				name: result.path.split(/[\\/]/).pop() || "Audio",
				volume: 1,
				sourceDurationMs,
			};
			pushState((prev) => ({
				audioRegions: [...prev.audioRegions, newRegion],
			}));
			handleSelectAudio(id);
			toast.success(`Added audio: ${newRegion.name}`);
		} catch (audioError) {
			toast.error(
				audioError instanceof Error ? audioError.message : "Could not add the audio file",
			);
		}
	}, [handleSelectAudio, pushState]);

	const handleAudioSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				audioRegions: prev.audioRegions.map((region) =>
					region.id === id ? resizeClipWithSlides(region, span, prev.blankSlideRegions) : region,
				),
			}));
		},
		[pushState],
	);

	const handleVideoClipSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				videoRegions: prev.videoRegions.map((region) =>
					region.id === id ? resizeClipWithSlides(region, span, prev.blankSlideRegions) : region,
				),
			}));
		},
		[pushState],
	);

	const handleAudioClipChange = useCallback(
		(id: string, patch: MediaClipPatch) => {
			pushState((prev) => ({
				audioRegions: prev.audioRegions.map((region) =>
					region.id === id ? normalizeMediaClipTiming({ ...region, ...patch }, true) : region,
				),
			}));
		},
		[pushState],
	);

	const handleVideoClipChange = useCallback(
		(id: string, patch: MediaClipPatch) => {
			pushState((prev) => ({
				videoRegions: prev.videoRegions.map((region) =>
					region.id === id ? normalizeMediaClipTiming({ ...region, ...patch }, true) : region,
				),
			}));
		},
		[pushState],
	);

	const handleAudioClipSplit = useCallback(
		(id: string) => {
			const region = audioRegions.find((clip) => clip.id === id);
			if (!region) return;
			const parts = splitClipWithSlides(
				region,
				currentTimeRef.current * 1000,
				`audio-${nextAudioIdRef.current++}`,
				blankSlideRegions,
			);
			if (!parts) return;
			pushState((prev) => ({
				audioRegions: prev.audioRegions.flatMap((clip) => (clip.id === id ? parts : [clip])),
			}));
			handleSelectAudio(parts[1].id);
		},
		[audioRegions, blankSlideRegions, pushState, handleSelectAudio],
	);

	const handleVideoClipSplit = useCallback(
		(id: string) => {
			const region = videoRegions.find((clip) => clip.id === id);
			if (!region) return;
			const parts = splitClipWithSlides(
				region,
				currentTimeRef.current * 1000,
				`video-component-${nextVideoRegionIdRef.current++}`,
				blankSlideRegions,
			);
			if (!parts) return;
			pushState((prev) => ({
				videoRegions: prev.videoRegions.flatMap((clip) => (clip.id === id ? parts : [clip])),
			}));
			handleSelectVideoRegion(parts[1].id);
		},
		[videoRegions, blankSlideRegions, pushState, handleSelectVideoRegion],
	);

	const handleAudioDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				audioRegions: prev.audioRegions.filter((region) => region.id !== id),
			}));
			if (selectedAudioId === id) setSelectedAudioId(null);
		},
		[pushState, selectedAudioId],
	);

	const handleBlankSlideAdded = useCallback(
		(span: Span) => {
			const id = `blank-slide-${nextBlankSlideIdRef.current++}`;
			const newRegion: BlankSlideRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				backgroundColor: "#f8fafc",
				transitionIn: "fade",
				transitionOut: "fade",
				transitionDurationMs: DEFAULT_SLIDE_TRANSITION_DURATION_MS,
			};
			pushState((prev) => ({
				blankSlideRegions: [...prev.blankSlideRegions, newRegion],
			}));
			handleSelectBlankSlide(id);
		},
		[handleSelectBlankSlide, pushState],
	);

	const handleBlankSlideSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				blankSlideRegions: prev.blankSlideRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleBlankSlideAppearanceChange = useCallback(
		(
			id: string,
			patch: Partial<
				Pick<
					BlankSlideRegion,
					"backgroundColor" | "transitionIn" | "transitionOut" | "transitionDurationMs"
				>
			>,
		) => {
			pushState((prev) => ({
				blankSlideRegions: prev.blankSlideRegions.map((region) =>
					region.id === id ? { ...region, ...patch } : region,
				),
			}));
		},
		[pushState],
	);

	const handleBlankSlideDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				blankSlideRegions: prev.blankSlideRegions.filter((region) => region.id !== id),
			}));
			if (selectedBlankSlideId === id) setSelectedBlankSlideId(null);
		},
		[pushState, selectedBlankSlideId],
	);

	const handleTimedAnnotationAdded = useCallback(
		(span: Span, type: "text" | "rectangle" | "figure") => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type,
				content: type === "text" ? "Enter text..." : "",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				rotation: 0,
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
				...(type === "rectangle"
					? { figureData: { ...DEFAULT_RECTANGLE_FIGURE_DATA } }
					: type === "figure"
						? { figureData: { ...DEFAULT_FIGURE_DATA } }
						: {}),
			};
			pushState((prev) => ({
				annotationRegions: [
					...prev.annotationRegions,
					{
						...newRegion,
						lane: laneForAnnotation(prev.annotationRegions, type, span),
					},
				],
			}));
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
		},
		[pushState],
	);

	const handleAnnotationAdded = useCallback(
		(span: Span) => handleTimedAnnotationAdded(span, "text"),
		[handleTimedAnnotationAdded],
	);

	const handleRectangleAdded = useCallback(
		(span: Span) => handleTimedAnnotationAdded(span, "rectangle"),
		[handleTimedAnnotationAdded],
	);

	const handleArrowAdded = useCallback(
		(span: Span) => handleTimedAnnotationAdded(span, "figure"),
		[handleTimedAnnotationAdded],
	);

	const handleAddImageAnnotation = useCallback(
		async (dataUrl: string) => {
			const size = await loadImageAnnotationSize(dataUrl);
			const timeRange = getImageAnnotationTimeRange(currentTime, duration);
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: timeRange.startMs,
				endMs: timeRange.endMs,
				type: "image",
				content: dataUrl,
				imageContent: dataUrl,
				position: { x: (100 - size.width) / 2, y: (100 - size.height) / 2 },
				size,
				rotation: 0,
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
			};
			pushState((prev) => ({
				annotationRegions: [
					...prev.annotationRegions,
					{
						...newRegion,
						lane: laneForAnnotation(prev.annotationRegions, "image", {
							start: newRegion.startMs,
							end: newRegion.endMs,
						}),
					},
				],
			}));
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
			setSelectedAudioId(null);
			toast.success(ts("imageUpload.uploadSuccess"));
		},
		[currentTime, duration, pushState, ts],
	);

	const handleShortcutImageInput = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;

			if (!isSupportedBackgroundImageType(file.type, file.name)) {
				toast.error(ts("imageUpload.invalidFileType"), {
					description: ts("imageUpload.jpgOnly"),
				});
				return;
			}

			const reader = new FileReader();
			reader.onload = (loadEvent) => {
				const dataUrl = loadEvent.target?.result;
				if (typeof dataUrl === "string") void handleAddImageAnnotation(dataUrl);
			};
			reader.onerror = () => {
				toast.error(ts("imageUpload.failedToUpload"), {
					description: ts("imageUpload.errorReading"),
				});
			};
			reader.readAsDataURL(file);
		},
		[handleAddImageAnnotation, ts],
	);

	const handleImageAddRequested = useCallback(() => {
		shortcutImageInputRef.current?.click();
	}, []);

	const handlePlayerDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingPlayerFile(true);
	}, []);

	const handlePlayerDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDraggingPlayerFile(false);
		}
	}, []);

	const handlePlayerDrop = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDraggingPlayerFile(false);
			const files = e.dataTransfer.files;
			if (!files || files.length === 0) return;
			const file = files[0];
			if (!isSupportedBackgroundImageType(file.type, file.name)) {
				toast.error(ts("imageUpload.invalidFileType"), {
					description: ts("imageUpload.jpgOnly"),
				});
				return;
			}
			const isShift = e.shiftKey;
			const reader = new FileReader();
			reader.onload = (event) => {
				const dataUrl = event.target?.result as string;
				if (!dataUrl) return;
				if (isShift) {
					void handleAddImageAnnotation(dataUrl);
				} else {
					saveCustomBackground(dataUrl);
					pushState({ wallpaper: dataUrl });
					toast.success(ts("imageUpload.uploadSuccess"));
				}
			};
			reader.onerror = () => {
				toast.error(ts("imageUpload.failedToUpload"), {
					description: ts("imageUpload.errorReading"),
				});
			};
			reader.readAsDataURL(file);
		},
		[handleAddImageAnnotation, pushState, ts],
	);

	const handleBlurAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "blur",
				content: "",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				rotation: 0,
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
				blurData: { ...DEFAULT_BLUR_DATA },
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedBlurId(id);
			setSelectedAnnotationId(null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAudioId(null);
		},
		[pushState],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => {
				const editedAutoCaption =
					prev.annotationRegions.find((region) => region.id === id)?.annotationSource ===
					"auto-caption";
				const next = prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				);
				return {
					annotationRegions: editedAutoCaption ? reconcileAutoCaptionTimelineGaps(next) : next,
				};
			});
		},
		[pushState],
	);

	const handleAnnotationPlacementChange = useCallback(
		(id: string, span: Span, lane: number) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								lane,
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			const sourceType = annotationRegions.find((region) => region.id === id)?.type;
			const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
			const duplicateZIndex = nextAnnotationZIndexRef.current++;
			pushState((prev) => {
				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) return {};

				const { annotationSource: _stripCaptionLink, ...sourceWithoutCaptionLink } = source;

				const duplicate: AnnotationRegion = {
					...sourceWithoutCaptionLink,
					id: duplicateId,
					lane: isAnnotationTrackKind(source.type)
						? laneForAnnotation(prev.annotationRegions, source.type, {
								start: source.startMs,
								end: source.endMs,
							})
						: undefined,
					zIndex: duplicateZIndex,
					position:
						source.type === "pen"
							? { ...source.position }
							: { x: source.position.x + 4, y: source.position.y + 4 },
					size: { ...source.size },
					style: { ...source.style },
					figureData: source.figureData ? { ...source.figureData } : undefined,
					penData: source.penData
						? {
								...source.penData,
								strokes: source.penData.strokes.map((stroke) => [...stroke]),
							}
						: undefined,
					blurData: source.blurData
						? {
								...source.blurData,
								freehandPoints: source.blurData.freehandPoints
									? [...source.blurData.freehandPoints]
									: undefined,
							}
						: undefined,
				};

				return { annotationRegions: [...prev.annotationRegions, duplicate] };
			});
			setSelectedAnnotationId(sourceType === "blur" ? null : duplicateId);
			setSelectedBlurId(sourceType === "blur" ? duplicateId : null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
		},
		[annotationRegions, pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
			}));
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
			if (selectedBlurId === id) {
				setSelectedBlurId(null);
			}
		},
		[selectedAnnotationId, selectedBlurId, pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					if (region.type === "text") {
						return { ...region, content, textContent: content };
					} else if (region.type === "image") {
						return { ...region, content, imageContent: content };
					}
					return { ...region, content };
				}),
			}));
		},
		[pushState],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					const updatedRegion = { ...region, type };
					if (type !== region.type) {
						updatedRegion.lane = isAnnotationTrackKind(type)
							? laneForAnnotation(
									prev.annotationRegions,
									type,
									{ start: region.startMs, end: region.endMs },
									region.id,
								)
							: undefined;
					}
					if (type === "text") {
						updatedRegion.content = region.textContent || "Enter text...";
					} else if (type === "image") {
						updatedRegion.content = region.imageContent || "";
					} else if (type === "figure") {
						updatedRegion.content = "";
						if (type !== region.type || !region.figureData) {
							updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
						}
					} else if (type === "rectangle") {
						updatedRegion.content = "";
						if (type !== region.type || !region.figureData) {
							updatedRegion.figureData = { ...DEFAULT_RECTANGLE_FIGURE_DATA };
						}
					} else if (type === "blur") {
						updatedRegion.content = "";
						if (!region.blurData) {
							updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
						}
					} else if (type === "pen") {
						updatedRegion.content = "";
						updatedRegion.position = { x: 0, y: 0 };
						updatedRegion.size = { width: 100, height: 100 };
						updatedRegion.rotation = 0;
						if (!region.penData) {
							updatedRegion.penData = { ...DEFAULT_PEN_DATA, strokes: [] };
						}
					} else if (type === "redact") {
						updatedRegion.content = "";
					}
					return updatedRegion;
				}),
			}));

			if (type === "blur" && selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
				setSelectedBlurId(id);
				setSelectedSpeedId(null);
			} else if (type !== "blur" && selectedBlurId === id) {
				setSelectedBlurId(null);
				setSelectedAnnotationId(id);
			}
		},
		[pushState, selectedAnnotationId, selectedBlurId],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			pushState((prev) => {
				const touched = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = touched?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, style: { ...region.style, ...style } };
						}
						return region.id === id ? { ...region, style: { ...region.style, ...style } } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, figureData } : region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationFigureDataPreviewChange = useCallback(
		(id: string, figureData: FigureData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, figureData } : region,
				),
			}));
		},
		[updateState],
	);

	const handleAnnotationPenDataChange = useCallback(
		(id: string, penData: PenData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, penData } : region,
				),
			}));
		},
		[updateState],
	);

	const handleAnnotationGeometryChange = useCallback(
		(id: string, patch: Partial<Pick<AnnotationRegion, "position" | "size" | "rotation">>) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, ...patch } : region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationReorder = useCallback(
		(id: string, direction: AnnotationOrder) => {
			pushState((prev) => {
				const ordered = [...prev.annotationRegions].sort((a, b) => a.zIndex - b.zIndex);
				const index = ordered.findIndex((region) => region.id === id);
				if (index < 0) return {};
				const target =
					direction === "back"
						? 0
						: direction === "front"
							? ordered.length - 1
							: direction === "backward"
								? index - 1
								: index + 1;
				if (target < 0 || target >= ordered.length || target === index) return {};
				const [moved] = ordered.splice(index, 1);
				ordered.splice(target, 0, moved);
				const zIndexById = new Map(ordered.map((region, order) => [region.id, order + 1]));
				nextAnnotationZIndexRef.current = Math.max(
					nextAnnotationZIndexRef.current,
					ordered.length + 1,
				);
				return {
					annotationRegions: prev.annotationRegions.map((region) => ({
						...region,
						zIndex: zIndexById.get(region.id) ?? region.zIndex,
					})),
				};
			});
		},
		[pushState],
	);

	const handleBlurDataPreviewChange = useCallback(
		(id: string, blurData: BlurData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								// Freehand drawing area is the full video surface.
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleBlurDataPanelChange = useCallback(
		(id: string, blurData: BlurData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			pushState((prev) => {
				const moved = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = moved?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, position };
						}
						return region.id === id ? { ...region, position } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			pushState((prev) => {
				const resized = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = resized?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, size };
						}
						return region.id === id ? { ...region, size } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleGuideAttachToVideo = useCallback(
		(session: GuideSession) => {
			const guideAnnotations = buildGuideVideoAnnotations(session, {
				nextId: () => `annotation-${nextAnnotationIdRef.current++}`,
				nextZIndex: () => nextAnnotationZIndexRef.current++,
			});
			const guideSpeedRegions = buildGuideVideoSpeedRegions(session, {
				nextId: () => `speed-${nextSpeedIdRef.current++}`,
			});
			if (guideAnnotations.length === 0 && guideSpeedRegions.length === 0) {
				toast.error("Generate a guide draft before attaching steps to the video.");
				return;
			}

			pushState((prev) => ({
				annotationRegions: replaceGuideVideoAnnotations(
					prev.annotationRegions,
					guideAnnotations,
					session.recordingId,
				),
				speedRegions: replaceGuideVideoSpeedRegions(
					prev.speedRegions,
					guideSpeedRegions,
					session.recordingId,
				),
			}));
			const firstTextAnnotation = guideAnnotations.find((annotation) => annotation.type === "text");
			setSelectedAnnotationId(firstTextAnnotation?.id ?? guideAnnotations[0]?.id ?? null);
			setSelectedBlurId(null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			// Frame-step navigation (arrow keys, no modifiers)
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) {
					return;
				}
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const newTime = computeFrameStepTime(
					currentTimeRef.current,
					durationRef.current,
					direction,
				);
				videoPlaybackRef.current?.seek(newTime);
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (selectedVideoRegionId && (e.key === "Delete" || e.key === "Backspace") && !isInput) {
				e.preventDefault();
				e.stopPropagation();
				handleVideoRegionDelete(selectedVideoRegionId);
				return;
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Let space pass through inside inputs/textareas.
				if (isInput) {
					return;
				}
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					playback.video.paused ? playback.play().catch(console.error) : playback.pause();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [undo, redo, shortcuts, isMac, selectedVideoRegionId, handleVideoRegionDelete]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
		if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
			setSelectedBlurId(null);
		}
	}, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	useEffect(() => {
		if (
			selectedVideoRegionId &&
			!videoRegions.some((region) => region.id === selectedVideoRegionId)
		) {
			setSelectedVideoRegionId(null);
		}
	}, [selectedVideoRegionId, videoRegions]);

	useEffect(() => {
		if (
			selectedBlankSlideId &&
			!blankSlideRegions.some((region) => region.id === selectedBlankSlideId)
		) {
			setSelectedBlankSlideId(null);
		}
	}, [blankSlideRegions, selectedBlankSlideId]);

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await window.electronAPI.revealInFolder(filePath);
			if (!result.success) {
				const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", errorMessage);
				toast.error(errorMessage);
			}
		} catch (error) {
			const errorMessage = String(error);
			console.error("Error calling revealInFolder IPC:", errorMessage);
			toast.error(`Error revealing in folder: ${errorMessage}`);
		}
	}, []);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video" | "Kdenlive", filePath: string) => {
			setExportedFilePath(filePath);
			const folder = parentDirectoryOf(filePath);
			if (folder) {
				saveUserPreferences({ exportFolder: folder });
			}
			toast.success(
				t("export.exportedSuccessfully", {
					format: formatLabel,
				}),
				{
					description: filePath,
					action: {
						label: rawT("common.actions.showInFolder"),
						onClick: () => {
							void handleShowExportedFile(filePath);
						},
					},
				},
			);
		},
		[handleShowExportedFile, t, rawT],
	);

	const handleExportKdenlive = useCallback(async () => {
		if (isExportingKdenlive) return;
		if (!currentProjectMedia) {
			toast.error(t("errors.unableToDetermineSourcePath"));
			return;
		}
		if (!Number.isFinite(duration) || duration <= 0) {
			toast.error(t("errors.videoNotReady"));
			return;
		}

		const fileNameBase =
			currentProjectMedia.screenVideoPath
				.split(/[\\/]/)
				.pop()
				?.replace(/\.[^.]+$/, "") || `openscreen-${Date.now()}`;

		const playbackVideo = videoPlaybackRef.current?.video;
		const screenWidth = playbackVideo?.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
		const screenHeight = playbackVideo?.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;

		setIsExportingKdenlive(true);
		try {
			const result = await nativeBridgeClient.project.exportKdenliveProject({
				handoff: {
					name: fileNameBase,
					screenSourcePath: currentProjectMedia.screenVideoPath,
					...(currentProjectMedia.webcamVideoPath
						? { webcamSourcePath: currentProjectMedia.webcamVideoPath }
						: {}),
					durationMs: duration * 1000,
					frameRate: 60,
					screenWidth,
					screenHeight,
					trimRegions: trimRegions.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })),
					speedRegions: speedRegions.map(({ id, startMs, endMs, speed }) => ({
						id,
						startMs,
						endMs,
						speed,
					})),
					zoomRegions: zoomRegions.map(
						({ id, startMs, endMs, depth, customScale, focus, focusMode }) => ({
							id,
							startMs,
							endMs,
							depth,
							customScale,
							...(focus ? { focus } : {}),
							...(focusMode ? { focusMode } : {}),
						}),
					),
					cursorSamples: cursorTelemetry.map(({ timeMs, cx, cy }) => ({
						tMs: timeMs,
						cx,
						cy,
					})),
					annotationRegions: annotationRegions.map(
						({ id, startMs, endMs, type, content, textContent }) => ({
							id,
							startMs,
							endMs,
							type,
							...(type === "text" ? { content, textContent } : {}),
						}),
					),
				},
				suggestedName: fileNameBase,
				exportFolder: getExportFolder(),
			});

			if (result.canceled) {
				toast.info(t("export.canceled"));
				return;
			}
			if (!result.success || !result.path) {
				toast.error(result.message || t("errors.failedToSaveExport"));
				return;
			}

			handleExportSaved("Kdenlive", result.path);
		} catch (error) {
			console.error("Failed to export Kdenlive handoff:", error);
			toast.error(error instanceof Error ? error.message : t("errors.failedToSaveExport"));
		} finally {
			setIsExportingKdenlive(false);
		}
	}, [
		annotationRegions,
		currentProjectMedia,
		cursorTelemetry,
		duration,
		handleExportSaved,
		isExportingKdenlive,
		speedRegions,
		t,
		trimRegions,
		zoomRegions,
	]);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const pickResult = await window.electronAPI.pickExportSavePath(
				unsavedExport.fileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				toast.info("Export canceled");
				return;
			}
			const saveResult = await window.electronAPI.writeExportToPath(
				unsavedExport.arrayBuffer,
				pickResult.path,
			);
			if (saveResult.success && saveResult.path) {
				setUnsavedExport(null);
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(
					buildSaveDiagnosticMessage(
						unsavedExport.format === "gif" ? "GIF" : "Video",
						saveResult.message || "Failed to save export",
					),
				);
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error(
				buildSaveDiagnosticMessage(
					unsavedExport.format === "gif" ? "GIF" : "Video",
					error instanceof Error ? error.message : "Failed to save exported video",
				),
			);
		}
	}, [unsavedExport, handleExportSaved]);

	const handleExport = useCallback(
		async (
			settings: ExportSettings,
			options?: { targetPath?: string },
		): Promise<McpControlResult> => {
			if (!videoPath) {
				toast.error("No video loaded");
				return { success: false, error: "No video loaded" };
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return { success: false, error: "Video not ready" };
			}

			// Pick the save path before exporting, otherwise the save dialog can end up
			// hidden behind other windows after a long-running export.
			const isGifFormat = settings.format === "gif";
			const targetFileName = `export-${Date.now()}.${isGifFormat ? "gif" : "mp4"}`;
			let targetPath = options?.targetPath;
			if (!targetPath) {
				const pickResult = await window.electronAPI.pickExportSavePath(
					targetFileName,
					getExportFolder(),
				);
				if (pickResult.canceled || !pickResult.success || !pickResult.path) {
					setShowExportDialog(false);
					return { success: false, message: "Export canceled" };
				}
				targetPath = pickResult.path;
			}

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
			let mcpResult: McpControlResult = {
				success: false,
				error: "Export did not complete",
			};

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
				const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
					sourceWidth,
					sourceHeight,
					cropRegion,
				);
				const videoOnly = settings.videoOnly === true;
				const aspectRatioValue = resolveExportAspectRatio({
					videoOnly,
					aspectRatio,
					sourceWidth,
					sourceHeight,
					cropRegion,
				});
				const editorFraming = {
					wallpaper,
					padding,
					videoPosition,
					videoScale,
					borderRadius,
					shadowIntensity,
					showBlur,
					webcamLayoutPreset,
				};
				const framing = videoOnly ? applyVideoOnlyFraming(editorFraming) : editorFraming;

				// Preview container dimensions, used for scaling.
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const previewHeight = containerElement?.clientHeight || DEFAULT_SOURCE_DIMENSIONS.height;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper: framing.wallpaper,
						zoomRegions,
						blankSlideRegions,
						trimRegions,
						speedRegions,
						showShadow: framing.shadowIntensity > 0,
						shadowIntensity: framing.shadowIntensity,
						showBlur: framing.showBlur,
						motionBlurAmount,
						borderRadius: framing.borderRadius,
						padding: framing.padding,
						videoPadding: framing.padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						cursorHighlight,
						cursorHighlightSize,
						annotationRegions,
						videoRegions,
						webcamLayoutPreset: framing.webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						videoPosition: framing.videoPosition,
						videoScale: framing.videoScale,
						videoTransformKeyframes: videoOnly ? [] : videoTransformKeyframes,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("GIF", saveResult.path);
							mcpResult = {
								success: true,
								path: saveResult.path,
								message: "GIF exported successfully",
							};
						} else {
							setUnsavedExport({
								arrayBuffer,
								fileName: targetFileName,
								format: "gif",
							});
							const message = buildSaveDiagnosticMessage(
								"GIF",
								saveResult.message || "Failed to save GIF",
							);
							setExportError(message);
							toast.error(message);
							mcpResult = { success: false, error: message };
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "GIF",
							reason: result.error || "GIF export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: settings.gifConfig.width,
							height: settings.gifConfig.height,
							frameRate: settings.gifConfig.frameRate,
						});
						setExportError(message);
						toast.error(message);
						mcpResult = { success: false, error: message };
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					const {
						width: exportWidth,
						height: exportHeight,
						bitrate,
					} = calculateMp4ExportSettings({
						quality,
						sourceWidth: effectiveSourceDimensions.width,
						sourceHeight: effectiveSourceDimensions.height,
						aspectRatioValue,
					});
					const exportCodec =
						exportWidth * exportHeight >= 3840 * 2160 ? "avc1.640034" : "avc1.640033";

					const exporter = new VideoExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: exportWidth,
						height: exportHeight,
						frameRate: 60,
						bitrate,
						codec: exportCodec,
						wallpaper: framing.wallpaper,
						zoomRegions,
						blankSlideRegions,
						trimRegions,
						speedRegions,
						showShadow: framing.shadowIntensity > 0,
						shadowIntensity: framing.shadowIntensity,
						showBlur: framing.showBlur,
						motionBlurAmount,
						borderRadius: framing.borderRadius,
						padding: framing.padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						cursorHighlight,
						cursorHighlightSize,
						annotationRegions,
						videoRegions,
						audioRegions: [
							...audioRegions,
							...videoRegions.filter((clip) => (clip.volume ?? 0) > 0),
						].map((region) => ({
							...region,
							sourceUrl: toFileUrl(region.sourcePath),
							volume: region.volume ?? 0,
						})),
						webcamLayoutPreset: framing.webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						videoPosition: framing.videoPosition,
						videoScale: framing.videoScale,
						videoTransformKeyframes: videoOnly ? [] : videoTransformKeyframes,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("Video", saveResult.path);
							mcpResult = {
								success: true,
								path: saveResult.path,
								message: "Video exported successfully",
							};
						} else {
							setUnsavedExport({
								arrayBuffer,
								fileName: targetFileName,
								format: "mp4",
							});
							const message = buildSaveDiagnosticMessage(
								"Video",
								saveResult.message || "Failed to save video",
							);
							setExportError(message);
							toast.error(message);
							mcpResult = { success: false, error: message };
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "Video",
							reason: result.error || "Export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: exportWidth,
							height: exportHeight,
							frameRate: 60,
							codec: exportCodec,
							bitrate,
						});
						setExportError(message);
						toast.error(message);
						mcpResult = { success: false, error: message };
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				}
			} catch (error) {
				console.error("Export error:", error);
				if (error instanceof BackgroundLoadError) {
					const message = t("errors.exportBackgroundLoadFailed", {
						url: error.displayUrl,
					});
					setExportError(message);
					toast.error(message);
					mcpResult = { success: false, error: message };
				} else {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					const message = buildExportDiagnosticMessage({
						formatLabel: settings.format === "gif" ? "GIF" : "Video",
						reason: errorMessage,
						sourcePath: videoSourcePath ?? videoPath,
					});
					setExportError(message);
					toast.error(t("errors.exportFailedWithError", { error: message }));
					mcpResult = { success: false, error: message };
				}
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				// Reset so the next export can reopen the dialog (second export
				// otherwise wouldn't show the save dialog).
				setShowExportDialog(false);
				setExportProgress(null);
			}
			return mcpResult;
		},
		[
			videoPath,
			videoSourcePath,
			webcamVideoPath,
			wallpaper,
			zoomRegions,
			blankSlideRegions,
			trimRegions,
			speedRegions,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			cursorRecordingData,
			annotationRegions,
			audioRegions,
			videoRegions,
			isPlaying,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			videoPosition,
			videoScale,
			videoTransformKeyframes,
			exportQuality,
			handleExportSaved,
			cursorTelemetry,
			cursorClickTimestamps,
			effectiveShowCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClipToBounds,
			cursorTheme,
			cursorHighlight,
			cursorHighlightSize,
			t,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
		const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
		const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
			sourceWidth,
			sourceHeight,
			cropRegion,
		);
		const aspectRatioValue = resolveExportAspectRatio({
			videoOnly: exportVideoOnly,
			aspectRatio,
			sourceWidth,
			sourceHeight,
			cropRegion,
		});
		const gifDimensions = calculateOutputDimensions(
			effectiveSourceDimensions.width,
			effectiveSourceDimensions.height,
			gifSizePreset,
			GIF_SIZE_PRESETS,
			aspectRatioValue,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			videoOnly: exportVideoOnly,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		exportFormat,
		exportQuality,
		exportVideoOnly,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		aspectRatio,
		cropRegion,
		handleExport,
	]);

	useEffect(() => {
		const unsubscribe = window.electronAPI?.onMcpControlRequest?.(async (request) => {
			if (request.action === "status") {
				return {
					success: true,
					recording: false,
					data: {
						videoPath,
						editorReady: Boolean(videoPlaybackRef.current?.video),
					},
				};
			}

			if (request.action !== "export_video") {
				return {
					success: false,
					error: `The editor cannot handle MCP action: ${request.action}`,
				};
			}

			const payload = (request.payload ?? {}) as McpExportVideoPayload;
			const requestedSettings = payload.settings ?? {};
			const settings: ExportSettings = {
				format: requestedSettings.format ?? "mp4",
				quality: requestedSettings.quality ?? exportQuality,
				gifConfig:
					requestedSettings.format === "gif" && requestedSettings.gifConfig
						? requestedSettings.gifConfig
						: undefined,
			};
			if (settings.format === "gif" && !settings.gifConfig) {
				return {
					success: false,
					error: "MCP GIF export requires gifConfig dimensions and frame settings.",
				};
			}

			return handleExport(settings, { targetPath: payload.outputPath });
		});

		return () => {
			unsubscribe?.();
		};
	}, [exportQuality, handleExport, videoPath]);
	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	const generateAutoCaptions = useCallback(
		async (minWords: number, maxWords: number) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return;
			}
			if (isAutoCaptioningRef.current) {
				toast.error(t("autoCaptions.busy"));
				return;
			}
			const minW = Math.max(1, Math.min(minWords, maxWords));
			const maxW = Math.max(minW, maxWords);

			isAutoCaptioningRef.current = true;
			setIsAutoCaptioning(true);
			toast.loading(t("autoCaptions.generating"), { id: AUTO_CAPTION_PROGRESS_TOAST_ID });
			try {
				const { samples, truncated, durationSec } = await extractMono16kFromVideoUrl(videoPath);
				if (!Number.isFinite(durationSec) || durationSec <= 0 || samples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				const { samples: speechSamples, trimSec } = trimLeadingSilenceMono16k(samples);
				if (speechSamples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				const trimMs = Math.round(trimSec * 1000);
				const trimRegionsForTranscribe = shiftTrimRegionsMsForCaptionBuffer(trimRegions, trimMs);

				const transcribeOptions = {
					onStatus: (phase: "model" | "transcribe") => {
						if (phase === "model") {
							toast.loading(t("autoCaptions.loadingModel"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						} else {
							toast.loading(t("autoCaptions.transcribing"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						}
					},
				};

				let { segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(
					speechSamples,
					{
						trimRegions: trimRegionsForTranscribe,
						...transcribeOptions,
					},
				);
				let transcribedFromTrimmedBuffer = true;

				// Leading-silence trimming can return empty even when the full source has
				// speech. Retry once against the untrimmed buffer before giving up.
				if (segmentsRaw.length === 0 && trimSec > 0) {
					({ segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(samples, {
						trimRegions,
						...transcribeOptions,
					}));
					transcribedFromTrimmedBuffer = false;
				}

				const segments =
					transcribedFromTrimmedBuffer && trimSec > 0
						? segmentsRaw.map((s) => ({
								...s,
								startSec: s.startSec + trimSec,
								endSec: s.endSec + trimSec,
							}))
						: segmentsRaw;

				let { regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
					segments,
					nextAnnotationIdRef.current,
					nextAnnotationZIndexRef.current,
					{
						minWordsPerCaption: minW,
						maxWordsPerCaption: maxW,
						timestampGranularity: granularity,
					},
				);

				if (regions.length === 0 && segments.length > 0) {
					({ regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
						segments,
						nextAnnotationIdRef.current,
						nextAnnotationZIndexRef.current,
						{
							minWordsPerCaption: 1,
							maxWordsPerCaption: Number.MAX_SAFE_INTEGER,
							timestampGranularity: granularity,
						},
					));
				}

				if (regions.length === 0) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.info(t("autoCaptions.noneHeard"));
					return;
				}

				pushState((prev) => ({ annotationRegions: [...prev.annotationRegions, ...regions] }));
				nextAnnotationIdRef.current = nextNumericId;
				nextAnnotationZIndexRef.current = nextZIndex;

				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const minutesTrunc = String(Math.round(MAX_CAPTION_AUDIO_SEC / 60));
				if (truncated) {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }), {
						description: t("autoCaptions.truncated", { minutes: minutesTrunc }),
					});
				} else {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }));
				}
			} catch (e) {
				console.error(e);
				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const detail = e instanceof Error ? e.message : String(e);
				toast.error(t("autoCaptions.failed"), { description: detail });
			} finally {
				isAutoCaptioningRef.current = false;
				setIsAutoCaptioning(false);
			}
		},
		[videoPath, trimRegions, pushState, t],
	);

	const handleSaveDiagnostic = useCallback(async () => {
		const result = await window.electronAPI.saveDiagnostic({
			error: exportError ?? "Manual diagnostic export",
			projectState: editorState,
			logs: [],
		});
		if (result.success) {
			toast.success("Diagnostic file saved");
		} else if (!result.canceled) {
			toast.error("Failed to save diagnostic file");
		}
	}, [exportError, editorState]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">{t("loadingVideo")}</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
					>
						{ts("project.load")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			<input
				ref={shortcutImageInputRef}
				type="file"
				accept={BACKGROUND_IMAGE_ACCEPT}
				className="hidden"
				onChange={handleShortcutImageInput}
				data-testid="shortcut-image-component-input"
			/>
			<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
				<DialogContent
					className="sm:max-w-[425px]"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("newRecording.title")}</DialogTitle>
						<DialogDescription>{t("newRecording.description")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowNewRecordingDialog(false)}
							className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
						>
							{t("newRecording.cancel")}
						</button>
						<button
							type="button"
							onClick={handleNewRecordingConfirm}
							className="px-4 py-2 rounded-md bg-[#34B27B] text-white hover:bg-[#34B27B]/90 text-sm font-medium transition-colors"
						>
							{t("newRecording.confirm")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={showAutoCaptionsDialog} onOpenChange={setShowAutoCaptionsDialog}>
				<DialogContent
					className="sm:max-w-md"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("autoCaptions.dialogTitle")}</DialogTitle>
						<DialogDescription>{t("autoCaptions.dialogDescription")}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="caption-min-words">{t("autoCaptions.minWords")}</Label>
							<Select
								value={String(captionWordsMin)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMin(n);
									if (n > captionWordsMax) setCaptionWordsMax(n);
								}}
							>
								<SelectTrigger id="caption-min-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`min-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="caption-max-words">{t("autoCaptions.maxWords")}</Label>
							<Select
								value={String(captionWordsMax)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMax(n);
									if (n < captionWordsMin) setCaptionWordsMin(n);
								}}
							>
								<SelectTrigger id="caption-max-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`max-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button
							type="button"
							variant="outline"
							onClick={() => setShowAutoCaptionsDialog(false)}
							className="border-white/20 bg-transparent text-white hover:bg-white/10"
						>
							{t("autoCaptions.dialogCancel")}
						</Button>
						<Button
							type="button"
							disabled={isAutoCaptioning}
							onClick={() => {
								setShowAutoCaptionsDialog(false);
								void generateAutoCaptions(captionWordsMin, captionWordsMax);
							}}
							className="bg-[#34B27B] text-white hover:bg-[#34B27B]/90"
						>
							{t("autoCaptions.generate")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div
				className="h-11 flex-shrink-0 bg-[#070809]/85 backdrop-blur-xl border-b border-white/[0.07] flex items-center justify-between px-5 z-50 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<div
					className="flex-1 flex items-center gap-1"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<div
						className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 ${isMac ? "ml-14" : "ml-2"}`}
					>
						<Languages size={14} />
						<select
							value={locale}
							onChange={(e) => setLocale(e.target.value as Locale)}
							className="bg-transparent text-[11px] font-medium outline-none cursor-pointer appearance-none pr-1"
							style={{ color: "inherit" }}
						>
							{availableLocales.map((loc) => (
								<option key={loc} value={loc} className="bg-[#09090b] text-white">
									{getLocaleName(loc)}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => setShowNewRecordingDialog(true)}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<Video size={14} />
						{t("newRecording.title")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<FolderOpen size={14} />
						{ts("project.load")}
					</button>
					<button
						type="button"
						onClick={handleSaveProject}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<Save size={14} />
						{ts("project.save")}
					</button>
					<button
						type="button"
						onClick={() => void handleAddVideoComponents()}
						className="flex items-center gap-1.5 rounded-lg bg-[#34B27B]/12 px-2.5 py-1.5 text-[11px] font-medium text-[#34B27B] transition-all duration-150 hover:bg-[#34B27B]/20"
						title={ts("videoComponents.addDescription")}
					>
						<Video size={14} />
						{ts("videoComponents.add")}
						{videoRegions.length > 0 && (
							<span className="rounded-full bg-[#34B27B]/20 px-1.5 py-0.5 text-[9px] font-bold">
								{videoRegions.length}
							</span>
						)}
					</button>
					{guideRecordingId && (
						<button
							type="button"
							onClick={() => setIsGuidePanelVisible((v) => !v)}
							className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 ${
								isGuidePanelVisible
									? "bg-[#34B27B]/15 text-[#34B27B] border border-[#34B27B]/30"
									: "text-white/50 hover:text-white/90 hover:bg-white/[0.08]"
							}`}
							title="Bật/Tắt hướng dẫn AI & OCR (Guide Mode)"
						>
							<ListChecks size={14} />
							AI Guide
						</button>
					)}
				</div>
			</div>

			{/* Empty state shown when no video is loaded */}
			{!videoPath && (
				<div className="flex-1 min-h-0 relative">
					<EditorEmptyState
						onVideoImported={(path) => {
							setVideoPath(toFileUrl(path));
							setVideoSourcePath(path);
							setWebcamVideoPath(null);
							setWebcamVideoSourcePath(null);
						}}
						onProjectOpened={async (project, path) => {
							const restored = await applyLoadedProject(project, path);
							if (!restored) {
								toast.error(t("project.invalidFormat"));
							}
						}}
					/>
				</div>
			)}

			{videoPath && (
				<div className="editor-workspace flex-1 min-h-0 relative">
					<PanelGroup direction="vertical" className="gap-3 min-h-0">
						{/* Top section: preview and contextual settings */}
						<Panel defaultSize={67} maxSize={76} minSize={46} className="min-h-[300px]">
							<div className="editor-main-deck h-full min-h-0">
								<div className="editor-preview-zone min-w-0 h-full">
									<div
										ref={playerContainerRef}
										onDragOver={handlePlayerDragOver}
										onDragLeave={handlePlayerDragLeave}
										onDrop={handlePlayerDrop}
										className={
											isFullscreen
												? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
												: "editor-preview-panel w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
										}
									>
										{isDraggingPlayerFile && (
											<div className="absolute inset-0 z-[100] bg-[#09090b]/85 backdrop-blur-md border-2 border-dashed border-[#34B27B] rounded-2xl flex flex-col items-center justify-center gap-3 animate-in fade-in duration-150 pointer-events-none p-6 text-center">
												<div className="w-16 h-16 rounded-2xl bg-[#34B27B]/15 border border-[#34B27B]/30 flex items-center justify-center text-[#34B27B] shadow-[0_0_30px_rgba(52,178,123,0.35)] animate-bounce">
													<ImageIcon className="w-8 h-8" />
												</div>
												<div className="space-y-1">
													<div className="text-base font-semibold text-white">
														{ts("background.dropImageHere")}
													</div>
													<div className="text-xs text-slate-300">
														<kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[10px]">
															Shift
														</kbd>
														{" · "}
														{ts("background.addImageOverlay")}
													</div>
												</div>
												<div className="text-[11px] text-slate-500">JPG · PNG · WEBP</div>
											</div>
										)}
										{/* Video preview */}
										<div className="w-full min-h-0 flex justify-center items-center flex-auto px-4 pt-4">
											<div
												className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
												style={{
													aspectRatio:
														aspectRatio === "native"
															? getNativeAspectRatioValue(
																	videoPlaybackRef.current?.video?.videoWidth ||
																		DEFAULT_SOURCE_DIMENSIONS.width,
																	videoPlaybackRef.current?.video?.videoHeight ||
																		DEFAULT_SOURCE_DIMENSIONS.height,
																	cropRegion,
																)
															: getAspectRatioValue(aspectRatio),
												}}
											>
												<VideoPlayback
													key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
													aspectRatio={aspectRatio}
													ref={videoPlaybackRef}
													videoPath={videoPath || ""}
													webcamVideoPath={webcamVideoPath || undefined}
													webcamLayoutPreset={webcamLayoutPreset}
													webcamMaskShape={webcamMaskShape}
													webcamSizePreset={webcamSizePreset}
													webcamPosition={webcamPosition}
													videoPosition={resolvedVideoTransform.position}
													videoScale={resolvedVideoTransform.scale}
													videoRegions={previewVideoRegions}
													selectedVideoRegionId={selectedVideoRegionId}
													onSelectVideoRegion={handleSelectVideoRegion}
													onVideoRegionGeometryChange={handleVideoRegionGeometryChange}
													onVideoRegionDelete={handleVideoRegionDelete}
													onVideoPositionChange={handleVideoPositionChange}
													onVideoPositionDragEnd={commitState}
													onVideoScaleChange={handleVideoScaleChange}
													onVideoScaleDragEnd={commitState}
													onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
													onWebcamPositionDragEnd={commitState}
													onDurationChange={setDuration}
													onTimeUpdate={setCurrentTime}
													currentTime={currentTime}
													onPlayStateChange={setIsPlaying}
													onError={setError}
													wallpaper={wallpaper}
													zoomRegions={zoomRegions}
													blankSlideRegions={blankSlideRegions}
													selectedZoomId={selectedZoomId}
													onSelectZoom={handleSelectZoom}
													onZoomFocusChange={handleZoomFocusChange}
													onZoomFocusDragEnd={commitState}
													isPlaying={isPlaying}
													showShadow={shadowIntensity > 0}
													shadowIntensity={shadowIntensity}
													showBlur={showBlur}
													motionBlurAmount={motionBlurAmount}
													borderRadius={borderRadius}
													padding={padding}
													cropRegion={cropRegion}
													cursorRecordingData={cursorRecordingData}
													trimRegions={trimRegions}
													speedRegions={speedRegions}
													annotationRegions={annotationOnlyRegions}
													selectedAnnotationId={selectedAnnotationId}
													onSelectAnnotation={handleSelectAnnotation}
													onAnnotationPositionChange={handleAnnotationPositionChange}
													onAnnotationSizeChange={handleAnnotationSizeChange}
													onAnnotationRotationChange={(id, rotation) =>
														handleAnnotationGeometryChange(id, { rotation })
													}
													onAnnotationFigureDataChange={handleAnnotationFigureDataPreviewChange}
													onAnnotationFigureDataCommit={commitState}
													blurRegions={blurRegions}
													selectedBlurId={selectedBlurId}
													onSelectBlur={handleSelectBlur}
													onBlurPositionChange={handleAnnotationPositionChange}
													onBlurSizeChange={handleAnnotationSizeChange}
													onBlurDataChange={handleBlurDataPreviewChange}
													onBlurDataCommit={commitState}
													onPenDataChange={handleAnnotationPenDataChange}
													onPenDataCommit={commitState}
													cursorTelemetry={cursorTelemetry}
													cursorClickTimestamps={cursorClickTimestamps}
													showCursor={effectiveShowCursor}
													cursorSize={cursorSize}
													cursorTheme={cursorTheme}
													cursorSmoothing={cursorSmoothing}
													cursorMotionBlur={cursorMotionBlur}
													cursorClickBounce={cursorClickBounce}
													cursorClipToBounds={cursorClipToBounds}
													cursorHighlight={cursorHighlight}
													cursorHighlightSize={cursorHighlightSize}
													isPreviewingZoom={isPreviewingZoom}
												/>
												{audioRegions.map((region) => (
													<AudioTrackPreview
														key={region.id}
														region={region}
														sourceUrl={toFileUrl(region.sourcePath)}
														currentTime={currentTime}
														isPlaying={isPlaying}
														speedRegions={speedRegions}
														blankSlideRegions={blankSlideRegions}
													/>
												))}
											</div>
										</div>
										{/* Playback controls */}
										<div className="w-full flex justify-center items-center h-14 flex-shrink-0 px-4 py-2">
											<div className="w-full max-w-[760px]">
												<PlaybackControls
													isPlaying={isPlaying}
													currentTime={currentTime}
													duration={duration}
													isFullscreen={isFullscreen}
													onToggleFullscreen={toggleFullscreen}
													onTogglePlayPause={togglePlayPause}
													onSeek={handleSeek}
												/>
											</div>
										</div>
									</div>
								</div>

								<div
									className={`editor-settings-rail flex min-w-0 h-full flex-col gap-3${
										guideRecordingId && isGuidePanelVisible
											? " editor-settings-rail--with-guide"
											: ""
									}`}
								>
									{guideRecordingId && isGuidePanelVisible && (
										<GuidePanel
											recordingId={guideRecordingId}
											videoPath={videoPath}
											videoSourcePath={videoSourcePath}
											currentTimeMs={currentTime * 1000}
											onAttachToVideo={handleGuideAttachToVideo}
											onClose={() => setIsGuidePanelVisible(false)}
										/>
									)}
									<div className="editor-settings-panel-slot min-h-0 flex-1 overflow-hidden">
										<SettingsPanel
											selected={wallpaper}
											onWallpaperChange={(w) => pushState({ wallpaper: w })}
											onApplySlideDesign={(patch) => pushState(patch)}
											onAddImageAnnotation={handleAddImageAnnotation}
											selectedZoomDepth={
												selectedZoomId
													? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
													: null
											}
											onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
											selectedZoomCustomScale={
												selectedZoomId
													? (zoomRegions.find((z) => z.id === selectedZoomId)?.customScale ?? null)
													: null
											}
											onZoomCustomScaleChange={handleZoomCustomScaleChange}
											onZoomCustomScaleCommit={handleZoomCustomScaleCommit}
											onZoomPreviewStart={() => setIsPreviewingZoom(true)}
											onZoomPreviewEnd={() => setIsPreviewingZoom(false)}
											selectedZoomFocusMode={
												selectedZoomId
													? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ??
														"manual")
													: null
											}
											onZoomFocusModeChange={(mode) =>
												selectedZoomId && handleZoomFocusModeChange(mode)
											}
											focusModeLocked={autoFocusAll}
											selectedZoomFocus={
												selectedZoomId
													? (zoomRegions.find((z) => z.id === selectedZoomId)?.focus ?? null)
													: null
											}
											onZoomFocusCoordinateChange={(focus) =>
												selectedZoomId && handleZoomFocusChange(selectedZoomId, focus)
											}
											onZoomFocusCoordinateCommit={commitState}
											hasCursorTelemetry={cursorTelemetry.length > 0}
											selectedZoomId={selectedZoomId}
											onZoomDelete={handleZoomDelete}
											selectedZoomRotationPreset={
												selectedZoomId
													? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ??
														null)
													: null
											}
											onZoomRotationPresetChange={handleZoomRotationPresetChange}
											selectedTrimId={selectedTrimId}
											onTrimDelete={handleTrimDelete}
											shadowIntensity={shadowIntensity}
											onShadowChange={(v) => updateState({ shadowIntensity: v })}
											onShadowCommit={commitState}
											showBlur={showBlur}
											onBlurChange={(v) => pushState({ showBlur: v })}
											showTrimWaveform={showTrimWaveform}
											onTrimWaveformChange={(v) => pushState({ showTrimWaveform: v })}
											motionBlurAmount={motionBlurAmount}
											onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
											onMotionBlurCommit={commitState}
											borderRadius={borderRadius}
											onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
											onBorderRadiusCommit={commitState}
											padding={padding}
											onPaddingChange={(v) => updateState({ padding: v })}
											onPaddingCommit={commitState}
											cropRegion={cropRegion}
											onCropChange={(r) => pushState({ cropRegion: r })}
											aspectRatio={aspectRatio}
											onAspectRatioChange={(ratio) => pushState({ aspectRatio: ratio })}
											hasWebcam={Boolean(webcamVideoPath)}
											webcamLayoutPreset={webcamLayoutPreset}
											onWebcamLayoutPresetChange={(preset) =>
												pushState({
													webcamLayoutPreset: preset,
													webcamPosition: preset === "picture-in-picture" ? webcamPosition : null,
												})
											}
											webcamMaskShape={webcamMaskShape}
											onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
											webcamMirrored={webcamMirrored}
											webcamReactiveZoom={webcamReactiveZoom}
											onWebcamMirroredChange={(mirrored) => pushState({ webcamMirrored: mirrored })}
											onWebcamReactiveZoomChange={(reactive) =>
												pushState({ webcamReactiveZoom: reactive })
											}
											webcamSizePreset={webcamSizePreset}
											onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
											onWebcamSizePresetCommit={commitState}
											videoElement={videoPlaybackRef.current?.video || null}
											exportQuality={exportQuality}
											onExportQualityChange={setExportQuality}
											exportFormat={exportFormat}
											onExportFormatChange={setExportFormat}
											exportVideoOnly={exportVideoOnly}
											onExportVideoOnlyChange={setExportVideoOnly}
											gifFrameRate={gifFrameRate}
											onGifFrameRateChange={setGifFrameRate}
											gifLoop={gifLoop}
											onGifLoopChange={setGifLoop}
											gifSizePreset={gifSizePreset}
											onGifSizePresetChange={setGifSizePreset}
											gifOutputDimensions={calculateOutputDimensions(
												calculateEffectiveSourceDimensions(
													videoPlaybackRef.current?.video?.videoWidth ||
														DEFAULT_SOURCE_DIMENSIONS.width,
													videoPlaybackRef.current?.video?.videoHeight ||
														DEFAULT_SOURCE_DIMENSIONS.height,
													cropRegion,
												).width,
												calculateEffectiveSourceDimensions(
													videoPlaybackRef.current?.video?.videoWidth ||
														DEFAULT_SOURCE_DIMENSIONS.width,
													videoPlaybackRef.current?.video?.videoHeight ||
														DEFAULT_SOURCE_DIMENSIONS.height,
													cropRegion,
												).height,
												gifSizePreset,
												GIF_SIZE_PRESETS,
												resolveExportAspectRatio({
													videoOnly: exportVideoOnly,
													aspectRatio,
													sourceWidth:
														videoPlaybackRef.current?.video?.videoWidth ||
														DEFAULT_SOURCE_DIMENSIONS.width,
													sourceHeight:
														videoPlaybackRef.current?.video?.videoHeight ||
														DEFAULT_SOURCE_DIMENSIONS.height,
													cropRegion,
												}),
											)}
											onExport={handleOpenExportDialog}
											onExportKdenlive={handleExportKdenlive}
											isExportingKdenlive={isExportingKdenlive}
											onExportPanelOpen={() => {
												setSelectedZoomId(null);
												setSelectedTrimId(null);
												setSelectedSpeedId(null);
											}}
											selectedAnnotationId={selectedAnnotationId}
											annotationRegions={annotationOnlyRegions}
											onAnnotationContentChange={handleAnnotationContentChange}
											onAnnotationTypeChange={handleAnnotationTypeChange}
											onAnnotationStyleChange={handleAnnotationStyleChange}
											onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
											onAnnotationGeometryChange={handleAnnotationGeometryChange}
											onAnnotationPenDataChange={handleAnnotationPenDataChange}
											onAnnotationPenDataCommit={commitState}
											onAnnotationReorder={handleAnnotationReorder}
											onAnnotationDuplicate={handleAnnotationDuplicate}
											onAnnotationDelete={handleAnnotationDelete}
											selectedBlurId={selectedBlurId}
											blurRegions={blurRegions}
											onBlurDataChange={handleBlurDataPanelChange}
											onBlurDataCommit={commitState}
											onBlurDelete={handleAnnotationDelete}
											selectedSpeedId={selectedSpeedId}
											selectedSpeedValue={
												selectedSpeedId
													? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
													: null
											}
											onSpeedChange={handleSpeedChange}
											onSpeedDelete={handleSpeedDelete}
											selectedVideoRegion={selectedVideoRegion}
											selectedAudioRegion={selectedAudioRegion}
											clipCurrentTime={
												selectedAudioRegion || selectedVideoRegion
													? clipContentTimeMs(
															(selectedAudioRegion || selectedVideoRegion)!,
															currentTime * 1000,
															blankSlideRegions,
														) / 1000
													: currentTime
											}
											clipTimelineDuration={duration}
											onAudioClipChange={handleAudioClipChange}
											onAudioClipSplit={handleAudioClipSplit}
											onAudioClipDelete={handleAudioDelete}
											onVideoClipChange={handleVideoClipChange}
											onVideoClipSplit={handleVideoClipSplit}
											onVideoClipFillCanvas={(id) =>
												handleVideoRegionGeometryChange(id, {
													position: { x: 0, y: 0 },
													size: { width: 100, height: 100 },
												})
											}
											onVideoRegionAppearanceChange={handleVideoRegionAppearanceChange}
											onVideoRegionAppearancePreview={handleVideoRegionAppearancePreview}
											onVideoRegionAppearanceCommit={commitState}
											onVideoRegionAspectRatioChange={handleVideoRegionAspectRatioChange}
											onVideoRegionDelete={handleVideoRegionDelete}
											unsavedExport={unsavedExport}
											onSaveUnsavedExport={handleSaveUnsavedExport}
											onSaveDiagnostic={handleSaveDiagnostic}
											showCursor={showCursor}
											onShowCursorChange={setShowCursor}
											cursorSize={cursorSize}
											onCursorSizeChange={setCursorSize}
											cursorSmoothing={cursorSmoothing}
											onCursorSmoothingChange={setCursorSmoothing}
											cursorMotionBlur={cursorMotionBlur}
											onCursorMotionBlurChange={setCursorMotionBlur}
											cursorClickBounce={cursorClickBounce}
											onCursorClickBounceChange={setCursorClickBounce}
											cursorClipToBounds={cursorClipToBounds}
											onCursorClipToBoundsChange={setCursorClipToBounds}
											cursorTheme={cursorTheme}
											onCursorThemeChange={setCursorTheme}
											cursorHighlight={cursorHighlight}
											onCursorHighlightChange={setCursorHighlight}
											cursorHighlightSize={cursorHighlightSize}
											onCursorHighlightSizeChange={setCursorHighlightSize}
											hasCursorData={
												cursorTelemetry.length > 0 ||
												hasNativeCursorRecordingData(cursorRecordingData)
											}
											showCursorSettings={showCursorSettings}
										/>
									</div>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="editor-resize-handle group">
							<div className="w-10 h-1 bg-white/20 rounded-full transition-colors group-hover:bg-[#34B27B]/70"></div>
						</PanelResizeHandle>

						{/* Full-width timeline */}
						<Panel defaultSize={33} maxSize={54} minSize={24} className="min-h-[210px]">
							<div className="editor-timeline-panel h-full overflow-hidden flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={cursorTelemetry}
									zoomRegions={zoomRegions}
									onZoomAdded={handleZoomAdded}
									onZoomSuggested={handleZoomSuggested}
									autoZoomEnabled={autoZoomEnabled}
									onToggleAutoZoom={handleToggleAutoZoom}
									autoFocusAll={autoFocusAll}
									onToggleAutoFocusAll={handleToggleAutoFocusAll}
									onZoomSpanChange={handleZoomSpanChange}
									onZoomDelete={handleZoomDelete}
									selectedZoomId={selectedZoomId}
									onSelectZoom={handleSelectZoom}
									trimRegions={trimRegions}
									onTrimAdded={handleTrimAdded}
									onTrimSpanChange={handleTrimSpanChange}
									onTrimDelete={handleTrimDelete}
									selectedTrimId={selectedTrimId}
									onSelectTrim={handleSelectTrim}
									speedRegions={speedRegions}
									onSpeedAdded={handleSpeedAdded}
									onSpeedSpanChange={handleSpeedSpanChange}
									onSpeedDelete={handleSpeedDelete}
									selectedSpeedId={selectedSpeedId}
									onSelectSpeed={handleSelectSpeed}
									audioRegions={timelineAudioRegions}
									onAudioAdded={handleAddAudio}
									onAudioSpanChange={handleAudioSpanChange}
									onAudioDelete={handleAudioDelete}
									selectedAudioId={selectedAudioId}
									onSelectAudio={handleSelectAudio}
									blankSlideRegions={blankSlideRegions}
									onBlankSlideAdded={handleBlankSlideAdded}
									onBlankSlideSpanChange={handleBlankSlideSpanChange}
									onBlankSlideAppearanceChange={handleBlankSlideAppearanceChange}
									onBlankSlideDelete={handleBlankSlideDelete}
									selectedBlankSlideId={selectedBlankSlideId}
									onSelectBlankSlide={handleSelectBlankSlide}
									annotationRegions={annotationOnlyRegions}
									onAnnotationAdded={handleAnnotationAdded}
									onRectangleAdded={handleRectangleAdded}
									onArrowAdded={handleArrowAdded}
									onImageAddRequested={handleImageAddRequested}
									onVideoAddRequested={handleAddVideoComponents}
									videoRegions={timelineVideoRegions}
									selectedVideoRegionId={selectedVideoRegionId}
									onSelectVideoRegion={handleSelectVideoRegion}
									onVideoClipSpanChange={handleVideoClipSpanChange}
									videoTransformKeyframes={videoTransformKeyframes}
									selectedVideoTransformKeyframeId={selectedVideoTransformKeyframeId}
									onVideoTransformKeyframeAdded={handleVideoTransformKeyframeAdded}
									onVideoTransformKeyframeMoved={handleVideoTransformKeyframeMove}
									onVideoTransformKeyframeMoveEnd={commitState}
									onVideoTransformKeyframeDeleted={handleVideoTransformKeyframeDelete}
									onSelectVideoTransformKeyframe={setSelectedVideoTransformKeyframeId}
									onAnnotationSpanChange={handleAnnotationSpanChange}
									onAnnotationPlacementChange={handleAnnotationPlacementChange}
									onAnnotationDelete={handleAnnotationDelete}
									selectedAnnotationId={selectedAnnotationId}
									onSelectAnnotation={handleSelectAnnotation}
									blurRegions={blurRegions}
									onBlurAdded={handleBlurAdded}
									onBlurSpanChange={handleAnnotationSpanChange}
									onBlurDelete={handleAnnotationDelete}
									selectedBlurId={selectedBlurId}
									onSelectBlur={handleSelectBlur}
									aspectRatio={aspectRatio}
									onAspectRatioChange={(ar) =>
										pushState({
											aspectRatio: ar,
											webcamLayoutPreset:
												(isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
												(!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
													? "picture-in-picture"
													: webcamLayoutPreset,
										})
									}
								/>
							</div>
						</Panel>
					</PanelGroup>
				</div>
			)}

			<ExportDialog
				isOpen={showExportDialog}
				onClose={() => setShowExportDialog(false)}
				progress={exportProgress}
				isExporting={isExporting}
				error={exportError}
				onCancel={handleCancelExport}
				exportFormat={exportFormat}
				exportedFilePath={exportedFilePath || undefined}
				onShowInFolder={
					exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
				}
			/>

			<UnsavedChangesDialog
				isOpen={showCloseConfirmDialog}
				onSaveAndClose={handleCloseConfirmSave}
				onDiscardAndClose={handleCloseConfirmDiscard}
				onCancel={handleCloseConfirmCancel}
			/>

			<UnsavedChangesDialog
				isOpen={confirmDialogVariant !== null}
				variant={confirmDialogVariant ?? "newProject"}
				onSaveAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmSave
						: handleNewProjectConfirmSave
				}
				onDiscardAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmDiscard
						: handleNewProjectConfirmDiscard
				}
				onCancel={() => setConfirmDialogVariant(null)}
			/>
		</div>
	);
}
