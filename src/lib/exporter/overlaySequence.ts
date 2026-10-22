import type {
	AnnotationRegion,
	CropRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	VideoRegion,
	VideoTransformKeyframe,
	ZoomRegion,
} from "@/components/video-editor/types";
import type { CursorRecordingData } from "@/native/contracts";
import { getPlatform } from "@/utils/platformUtils";
import { FrameRenderer } from "./frameRenderer";
import { decodeWithInsertedSlides, slideExportMetrics } from "./insertedSlideDecoder";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { VideoRegionFrameProvider } from "./videoRegionFrameProvider";

export interface OverlaySequenceConfig {
	videoUrl: string;
	width: number;
	height: number;
	/** Project frame rate; the sequence has one PNG per timeline frame. */
	frameRate: number;
	cropRegion: CropRegion;
	padding?: number;
	videoPadding?: number;
	videoPosition?: { cx: number; cy: number } | null;
	videoScale?: number;
	videoTransformKeyframes?: VideoTransformKeyframe[];
	borderRadius?: number;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	annotationRegions?: AnnotationRegion[];
	videoRegions?: VideoRegion[];
	cursorRecordingData?: CursorRecordingData | null;
	cursorScale?: number;
	cursorSmoothing?: number;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClipToBounds?: boolean;
	cursorTheme?: string;
	cursorHighlight?: boolean;
	cursorHighlightSize?: number;
	previewWidth?: number;
	previewHeight?: number;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorClickTimestamps?: number[];
	/** Receives each encoded transparent PNG in timeline order. */
	onFrame: (index: number, png: ArrayBuffer) => Promise<void> | void;
	onProgress?: (frame: number, totalFrames: number) => void;
}

export interface OverlaySequenceResult {
	frameCount: number;
	cancelled: boolean;
	warnings: string[];
}

/**
 * Renders the Kdenlive handoff overlay: an effects-only pass (cursor,
 * annotations, video regions) over transparency, emitted as one PNG per
 * timeline frame. Wallpaper, recording and webcam pixels are skipped so the
 * Kdenlive project keeps compositing those as native editable tracks beneath
 * the overlay.
 *
 * Blank slides are not supported: the handoff timeline models trims and speed
 * only, so callers must skip the overlay (with a warning) when slides exist.
 */
export class OverlaySequenceRenderer {
	private cancelled = false;
	private decoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private videoRegionFrameProvider: VideoRegionFrameProvider | null = null;

	constructor(private readonly config: OverlaySequenceConfig) {}

	cancel(): void {
		this.cancelled = true;
		this.decoder?.cancel();
		this.videoRegionFrameProvider?.destroy();
	}

	async run(): Promise<OverlaySequenceResult> {
		const warnings: string[] = [];
		const onWarning = (message: string) => warnings.push(message);

		const platform = await getPlatform();
		const decoder = new StreamingVideoDecoder();
		this.decoder = decoder;
		const videoInfo = await decoder.loadMetadata(this.config.videoUrl);

		let videoRegionFrameProvider: VideoRegionFrameProvider | null = null;
		if (this.config.videoRegions?.length) {
			videoRegionFrameProvider = new VideoRegionFrameProvider();
			this.videoRegionFrameProvider = videoRegionFrameProvider;
			await videoRegionFrameProvider.initialize(this.config.videoRegions);
		}

		const renderer = new FrameRenderer({
			width: this.config.width,
			height: this.config.height,
			wallpaper: "#000000",
			overlayOnly: true,
			zoomRegions: this.config.zoomRegions,
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: this.config.cropRegion,
			padding: this.config.padding,
			borderRadius: this.config.borderRadius,
			cursorRecordingData: this.config.cursorRecordingData,
			cursorScale: this.config.cursorScale,
			cursorSmoothing: this.config.cursorSmoothing,
			cursorMotionBlur: this.config.cursorMotionBlur,
			cursorClickBounce: this.config.cursorClickBounce,
			cursorClipToBounds: this.config.cursorClipToBounds,
			cursorTheme: this.config.cursorTheme,
			cursorHighlight: this.config.cursorHighlight,
			cursorHighlightSize: this.config.cursorHighlightSize,
			videoWidth: videoInfo.width,
			videoHeight: videoInfo.height,
			webcamSize: null,
			videoPosition: this.config.videoPosition,
			videoScale: this.config.videoScale,
			videoTransformKeyframes: this.config.videoTransformKeyframes,
			annotationRegions: this.config.annotationRegions,
			videoRegions: this.config.videoRegions,
			speedRegions: this.config.speedRegions,
			previewWidth: this.config.previewWidth,
			previewHeight: this.config.previewHeight,
			cursorTelemetry: this.config.cursorTelemetry,
			cursorClickTimestamps: this.config.cursorClickTimestamps,
			platform,
		});
		this.renderer = renderer;
		await renderer.initialize();

		const { totalFrames } = slideExportMetrics(
			decoder,
			videoInfo.duration,
			this.config.frameRate,
			this.config.trimRegions,
			this.config.speedRegions,
			[],
		);

		videoRegionFrameProvider?.start(this.config.frameRate, onWarning);

		let frameIndex = 0;
		try {
			await decodeWithInsertedSlides(
				decoder,
				videoInfo.duration,
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				[],
				async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
					if (this.cancelled) {
						return;
					}
					const videoRegionFrames = videoRegionFrameProvider
						? await videoRegionFrameProvider.framesAt(sourceTimestampMs, [])
						: null;
					try {
						await renderer.renderFrame(
							videoFrame,
							sourceTimestampMs * 1000,
							null,
							videoRegionFrames ?? undefined,
						);
						const canvas = renderer.getCanvas();
						const blob = await new Promise<Blob>((resolve, reject) => {
							canvas.toBlob(
								(encoded) =>
									encoded
										? resolve(encoded)
										: reject(new Error("Failed to encode the overlay frame as PNG.")),
								"image/png",
							);
						});
						await this.config.onFrame(frameIndex, await blob.arrayBuffer());
						frameIndex++;
						this.config.onProgress?.(frameIndex, totalFrames);
					} finally {
						videoFrame.close();
						for (const frame of videoRegionFrames?.values() ?? []) frame.close();
					}
				},
				onWarning,
				() => this.cancelled,
			);
		} finally {
			await videoRegionFrameProvider?.stop().catch(() => undefined);
		}

		return { frameCount: frameIndex, cancelled: this.cancelled, warnings };
	}

	destroy(): void {
		this.cancelled = true;
		this.renderer?.destroy();
		this.renderer = null;
		this.decoder?.destroy();
		this.decoder = null;
		this.videoRegionFrameProvider?.destroy();
		this.videoRegionFrameProvider = null;
	}
}
