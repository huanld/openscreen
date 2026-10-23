import { AppWindow, Camera, FolderOpen, Monitor, RefreshCw, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { nativeBridgeClient } from "@/native";
import type { ScreenshotImage } from "@/native/contracts";
import ImageEditor from "./ImageEditor";

export default function ScreenshotWorkspace() {
	const t = useScopedT("screenshot");
	const [sources, setSources] = useState<ProcessedDesktopSource[]>([]);
	const [selectedId, setSelectedId] = useState("");
	const [kind, setKind] = useState<"screen" | "window">("screen");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [image, setImage] = useState<ScreenshotImage | null>(null);
	const inFlight = useRef(false);
	const refreshId = useRef(0);

	const refreshSources = useCallback(async () => {
		const requestId = ++refreshId.current;
		setLoading(true);
		setError("");
		try {
			const items = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 360, height: 220 },
				fetchWindowIcons: false,
			});
			if (requestId !== refreshId.current) return;
			setSources(items);
			setSelectedId((previous) => (items.some((item) => item.id === previous) ? previous : ""));
		} catch (cause) {
			if (requestId === refreshId.current) {
				setError(cause instanceof Error ? cause.message : t("sourcesError"));
			}
		} finally {
			if (requestId === refreshId.current) setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		const isPrewarmed = new URLSearchParams(window.location.search).get("prewarm") === "1";
		let initialRefreshRequested = false;
		const refreshWhenShown = () => {
			if (initialRefreshRequested) return;
			initialRefreshRequested = true;
			void refreshSources();
		};
		if (!isPrewarmed) refreshWhenShown();
		const refreshWhenVisible = () => {
			if (document.visibilityState === "visible") refreshWhenShown();
		};
		window.addEventListener("focus", refreshWhenShown);
		document.addEventListener("visibilitychange", refreshWhenVisible);
		return () => {
			window.removeEventListener("focus", refreshWhenShown);
			document.removeEventListener("visibilitychange", refreshWhenVisible);
			refreshId.current++;
		};
	}, [refreshSources]);

	const acquireImage = useCallback(
		async (operation: () => Promise<ScreenshotImage | null>) => {
			if (inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			setError("");
			try {
				const result = await operation();
				if (result) setImage(result);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : t("captureError"));
			} finally {
				inFlight.current = false;
				setBusy(false);
			}
		},
		[t],
	);

	useEffect(() => {
		if (image) return;
		return window.electronAPI?.onMenuLoadProject?.(() => {
			void acquireImage(() => nativeBridgeClient.screenshot.openImage());
		});
	}, [image, acquireImage]);

	useEffect(() => {
		const removeCapture = window.electronAPI?.onScreenshotRegionShortcut?.(() => {
			void acquireImage(async () => {
				try {
					const result = await nativeBridgeClient.screenshot.captureRegion();
					if (result) await nativeBridgeClient.screenshot.openWindow();
					return result;
				} catch (cause) {
					await nativeBridgeClient.screenshot.openWindow();
					throw cause;
				}
			});
		});
		const removeBlocked = window.electronAPI?.onScreenshotRegionShortcutBlocked?.(() => {
			toast.warning(t("shortcutUnsaved"));
		});
		return () => {
			removeCapture?.();
			removeBlocked?.();
		};
	}, [acquireImage, t]);

	if (image) {
		return (
			<ImageEditor
				image={image}
				onBack={() => {
					setImage(null);
					void refreshSources();
				}}
				onSave={async (dataUrl, format) => {
					const result = await nativeBridgeClient.screenshot.saveImage(dataUrl, format);
					if (result.canceled) return false;
					toast.success(t("saved"), { description: result.path });
					return true;
				}}
				onCopy={async (dataUrl) => {
					await nativeBridgeClient.screenshot.copyImage(dataUrl);
					toast.success(t("copied"));
				}}
				onRecognize={(dataUrl) => nativeBridgeClient.screenshot.recognizeText(dataUrl)}
			/>
		);
	}

	const visibleSources = sources.filter((source) => source.id.startsWith(`${kind}:`));
	const selectedSource = visibleSources.find((source) => source.id === selectedId);
	const buttonClass =
		"inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-medium transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";

	return (
		<main
			className="flex h-screen flex-col bg-[#101214] text-zinc-100"
			data-testid="screenshot-workspace"
		>
			<header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-7 py-5">
				<div>
					<h1 className="flex items-center gap-2 text-xl font-semibold">
						<Camera className="text-emerald-400" size={22} />
						{t("title")}
					</h1>
					<p className="mt-1 text-sm text-zinc-400">{t("subtitle")}</p>
				</div>
				<button
					type="button"
					className={buttonClass}
					disabled={busy}
					onClick={() => void acquireImage(() => nativeBridgeClient.screenshot.openImage())}
				>
					<FolderOpen size={17} />
					{t("openImage")}
				</button>
			</header>
			<div className="mx-7 mt-5 flex items-center gap-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
				<button
					type="button"
					data-testid="screenshot-capture-region"
					className={`${buttonClass} shrink-0 border-emerald-400 bg-emerald-500 text-zinc-950 hover:bg-emerald-400`}
					disabled={busy}
					onClick={() =>
						void acquireImage(() =>
							nativeBridgeClient.screenshot.captureRegion(
								kind === "screen" ? selectedSource?.id : undefined,
							),
						)
					}
				>
					<ScanLine size={19} />
					{busy ? t("capturing") : t("captureRegion")}
				</button>
				<p className="text-sm leading-6 text-zinc-300">{t("regionHint")}</p>
			</div>
			<div className="flex items-center justify-between gap-3 px-7 pt-5">
				<div className="flex gap-2" role="group" aria-label={t("sourceType")}>
					{(["screen", "window"] as const).map((value) => (
						<button
							key={value}
							type="button"
							aria-pressed={kind === value}
							className={`${buttonClass} ${kind === value ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "text-zinc-400"}`}
							disabled={busy}
							onClick={() => setKind(value)}
						>
							{value === "screen" ? <Monitor size={17} /> : <AppWindow size={17} />}
							{t(value === "screen" ? "screens" : "windows")}
						</button>
					))}
				</div>
				<button
					type="button"
					className={buttonClass}
					disabled={loading || busy}
					onClick={() => void refreshSources()}
				>
					<RefreshCw size={16} />
					{t("refresh")}
				</button>
			</div>
			{error && (
				<p
					role="alert"
					className="mx-7 mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
				>
					{error}
				</p>
			)}
			<section
				className="min-h-0 flex-1 overflow-auto p-7"
				aria-label={t("sourceType")}
				aria-busy={loading || busy}
			>
				{loading ? (
					<p role="status" className="py-16 text-center text-zinc-400">
						{t("loading")}
					</p>
				) : visibleSources.length === 0 ? (
					<p className="py-16 text-center text-zinc-400">{t("noSources")}</p>
				) : (
					<div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
						{visibleSources.map((source) => (
							<button
								type="button"
								key={source.id}
								data-testid="screenshot-source"
								data-source-kind={kind}
								aria-pressed={selectedId === source.id}
								disabled={busy}
								onClick={() => setSelectedId(source.id)}
								className={`overflow-hidden rounded-xl border p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${selectedId === source.id ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 bg-white/[0.025] hover:border-white/30"}`}
							>
								<div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black/40">
									{source.thumbnail ? (
										<img src={source.thumbnail} alt="" className="h-full w-full object-contain" />
									) : (
										<Monitor className="text-zinc-600" size={40} />
									)}
								</div>
								<p className="truncate px-1 pb-1 pt-3 text-sm" title={source.name}>
									{source.name}
								</p>
							</button>
						))}
					</div>
				)}
			</section>
			<footer className="flex items-center justify-between gap-6 border-t border-white/10 px-7 py-4">
				<p className="max-w-xl text-sm text-zinc-400">{t("captureHint")}</p>
				<button
					type="button"
					data-testid="screenshot-capture"
					className={`${buttonClass} shrink-0`}
					disabled={!selectedSource || loading || busy}
					onClick={() => void acquireImage(() => nativeBridgeClient.screenshot.capture(selectedId))}
				>
					<Camera size={17} />
					{busy ? t("capturing") : t("capture")}
				</button>
			</footer>
		</main>
	);
}
