import { X } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { nativeBridgeClient } from "@/native";
import type { ScreenshotImage, ScreenshotRegion } from "@/native/contracts";
import { regionFromDrag } from "./regionSelection";
import styles from "./ScreenshotRegionOverlay.module.css";

export default function ScreenshotRegionOverlay() {
	const t = useScopedT("screenshot");
	const [image, setImage] = useState<ScreenshotImage | null>(null);
	const [ready, setReady] = useState(false);
	const [selection, setSelection] = useState<ScreenshotRegion | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const inFlight = useRef(false);
	const loadId = useRef(0);
	const gesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);

	const finish = useCallback(
		async (region: ScreenshotRegion | null) => {
			if (inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			try {
				await nativeBridgeClient.screenshot.completeRegionSelection(region);
			} catch (cause) {
				if (region === null) {
					window.close();
					return;
				}
				setError(cause instanceof Error ? cause.message : t("region.error"));
				inFlight.current = false;
				setBusy(false);
			}
		},
		[t],
	);

	useEffect(() => {
		let cancelled = false;
		const loadSelection = (required: boolean) => {
			const requestId = ++loadId.current;
			inFlight.current = false;
			gesture.current = null;
			setImage(null);
			setReady(false);
			setSelection(null);
			setError("");
			setBusy(false);
			void nativeBridgeClient.screenshot
				.getRegionSelection()
				.then((result) => {
					if (cancelled || requestId !== loadId.current) return;
					if (result) setImage(result);
					else if (required) setError(t("region.unavailable"));
				})
				.catch((cause) => {
					if (!cancelled && requestId === loadId.current && required) {
						setError(cause instanceof Error ? cause.message : t("region.error"));
					}
				});
		};
		const removeStart = window.electronAPI?.onScreenshotRegionSelectionStart?.(() => {
			loadSelection(true);
		});
		const isPrepared = new URLSearchParams(window.location.search).get("prewarm") === "1";
		if (!isPrepared) loadSelection(true);
		surfaceRef.current?.focus();
		return () => {
			cancelled = true;
			loadId.current++;
			removeStart?.();
		};
	}, [t]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			gesture.current = null;
			void finish(null);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [finish]);

	function pointerPoint(event: ReactPointerEvent<HTMLDivElement>) {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			x: event.clientX - bounds.left,
			y: event.clientY - bounds.top,
			width: bounds.width,
			height: bounds.height,
		};
	}

	function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0 || !ready || busy) return;
		if (!event.isPrimary) {
			gesture.current = null;
			setSelection(null);
			return;
		}
		event.preventDefault();
		const point = pointerPoint(event);
		gesture.current = { pointerId: event.pointerId, x: point.x, y: point.y };
		setSelection(null);
		setError("");
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
		const start = gesture.current;
		if (!start || start.pointerId !== event.pointerId || busy) return;
		const point = pointerPoint(event);
		setSelection(regionFromDrag(start, point, point, 0));
	}

	function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
		const start = gesture.current;
		if (!start || start.pointerId !== event.pointerId || busy) return;
		gesture.current = null;
		const point = pointerPoint(event);
		const region = regionFromDrag(start, point, point);
		setSelection(region);
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
		if (region) void finish(region);
	}

	const width =
		selection && image
			? Math.ceil((selection.x + selection.width) * image.width) -
				Math.floor(selection.x * image.width)
			: 0;
	const height =
		selection && image
			? Math.ceil((selection.y + selection.height) * image.height) -
				Math.floor(selection.y * image.height)
			: 0;

	return (
		<div
			ref={surfaceRef}
			className={styles.surface}
			data-testid="screenshot-region-overlay"
			role="application"
			aria-label={t("region.title")}
			aria-describedby="region-instructions"
			aria-busy={busy || !ready}
			tabIndex={-1}
			onPointerDown={beginDrag}
			onPointerMove={moveDrag}
			onPointerUp={endDrag}
			onPointerCancel={() => {
				gesture.current = null;
				setSelection(null);
			}}
			onLostPointerCapture={() => {
				gesture.current = null;
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				void finish(null);
			}}
		>
			{image && (
				<img
					src={image.dataUrl}
					alt=""
					data-testid="screenshot-region-image"
					className={styles.image}
					draggable={false}
					onLoad={() => setReady(true)}
					onError={() => setError(t("region.error"))}
				/>
			)}
			{selection ? (
				<div
					className={styles.selection}
					data-testid="screenshot-region-selection"
					style={{
						left: `${selection.x * 100}%`,
						top: `${selection.y * 100}%`,
						width: `${selection.width * 100}%`,
						height: `${selection.height * 100}%`,
					}}
				/>
			) : (
				<div className={styles.shade} />
			)}
			<div
				className={styles.instructions}
				id="region-instructions"
				data-testid="screenshot-region-instructions"
			>
				<strong>{t("region.title")}</strong>
				<span>{busy ? t("capturing") : ready ? t("region.hint") : t("region.loading")}</span>
				{selection && (
					<span className={styles.dimensions} data-testid="screenshot-region-dimensions">
						{width} × {height} px
					</span>
				)}
			</div>
			<button
				type="button"
				className={styles.cancel}
				data-testid="screenshot-region-cancel"
				disabled={busy}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={() => void finish(null)}
			>
				<X size={18} />
				{t("region.cancel")}
			</button>
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
		</div>
	);
}
