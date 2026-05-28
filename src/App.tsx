import { lazy, Suspense, useEffect, useState } from "react";
import { CountdownOverlay } from "./components/launch/CountdownOverlay.tsx";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";

const VideoEditor = lazy(() => import("./components/video-editor/VideoEditor"));
const ShortcutsConfigDialog = lazy(() =>
	import("./components/video-editor/ShortcutsConfigDialog").then((module) => ({
		default: module.ShortcutsConfigDialog,
	})),
);

export default function App() {
	const [windowType, setWindowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const hasElectronBridge = Boolean(window.electronAPI);

	useEffect(() => {
		const type = new URLSearchParams(window.location.search).get("windowType") || "";
		if (type !== windowType) {
			setWindowType(type);
		}

		if (type === "hud-overlay" || type === "source-selector" || type === "countdown-overlay") {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		// HUD is a fixed-size BrowserWindow; pin the document shell and hide overflow
		// so the renderer can't introduce scrollbars (see issue #305).
		if (type === "hud-overlay") {
			document.documentElement.style.height = "100%";
			document.documentElement.style.overflow = "hidden";
			document.body.style.height = "100%";
			document.body.style.margin = "0";
			document.body.style.overflow = "hidden";
			const root = document.getElementById("root");
			root?.style.setProperty("height", "100%");
			root?.style.setProperty("min-height", "0");
			root?.style.setProperty("overflow", "hidden");
		}
	}, [windowType]);

	useEffect(() => {
		// Load custom fonts on app initialization
		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	const content = (() => {
		switch (windowType) {
			case "hud-overlay":
				return <LaunchWindow />;
			case "source-selector":
				return <SourceSelector />;
			case "countdown-overlay":
				return <CountdownOverlay />;
			case "editor":
				return (
					<ShortcutsProvider>
						<Suspense fallback={<div className="h-screen bg-background" />}>
							<VideoEditor />
							<ShortcutsConfigDialog />
						</Suspense>
					</ShortcutsProvider>
				);
			default:
				return hasElectronBridge ? <LaunchWindow /> : <BrowserDevFallback />;
		}
	})();

	return (
		<TooltipProvider>
			{content}
			<Toaster theme="dark" className="pointer-events-auto" />
		</TooltipProvider>
	);
}

function BrowserDevFallback() {
	return (
		<div className="flex h-screen w-screen items-center justify-center bg-[#08090b] px-6 text-slate-100">
			<div className="w-full max-w-[520px] rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-2xl">
				<h1 className="mb-2 text-xl font-semibold tracking-normal">OpenScreen desktop app</h1>
				<p className="mb-4 text-sm leading-6 text-slate-300">
					This localhost page is only the Vite renderer. Recording, file access, guide generation,
					and export require the Electron window because those actions use the preload bridge.
				</p>
				<div className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300">
					Use the separate Electron window titled <span className="text-slate-100">openscreen</span>
					.
				</div>
			</div>
		</div>
	);
}
