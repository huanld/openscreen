import { Crop, Maximize2, Minimize2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { MediaClipSettingsPanel, type MediaClipSettingsProps } from "./MediaClipSettingsPanel";
import type { VideoRegion, VideoRegionAspectRatio } from "./types";

type AppearancePatch = Partial<Pick<VideoRegion, "fitMode" | "cropPosition" | "cropZoom">>;

interface VideoComponentSettingsPanelProps {
	region: VideoRegion;
	clipSettings?: MediaClipSettingsProps;
	onFillCanvas?: () => void;
	onAppearanceChange: (patch: AppearancePatch) => void;
	onAppearancePreview: (patch: AppearancePatch) => void;
	onAppearanceCommit: () => void;
	onAspectRatioChange: (aspectRatio: VideoRegionAspectRatio) => void;
	onDelete: () => void;
}

const ASPECT_RATIO_OPTIONS: VideoRegionAspectRatio[] = [
	"source",
	"free",
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"1:1",
];

const CROP_POSITION_PRESETS = [
	{ x: 0, y: 0 },
	{ x: 50, y: 0 },
	{ x: 100, y: 0 },
	{ x: 0, y: 50 },
	{ x: 50, y: 50 },
	{ x: 100, y: 50 },
	{ x: 0, y: 100 },
	{ x: 50, y: 100 },
	{ x: 100, y: 100 },
] as const;

export function VideoComponentSettingsPanel({
	region,
	clipSettings,
	onFillCanvas,
	onAppearanceChange,
	onAppearancePreview,
	onAppearanceCommit,
	onAspectRatioChange,
	onDelete,
}: VideoComponentSettingsPanelProps) {
	const t = useScopedT("settings");
	const fitMode = region.fitMode ?? "cover";
	const cropPosition = region.cropPosition ?? { x: 50, y: 50 };
	const cropZoom = region.cropZoom ?? 1;
	const frameAspectRatio = region.frameAspectRatio ?? "source";

	return (
		<div className="flex h-full min-w-0 flex-col overflow-y-auto p-4 custom-scrollbar">
			<div className="mb-5 min-w-0">
				<span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#34B27B]">
					{t("videoComponents.editTitle")}
				</span>
				<div className="mt-1 truncate text-lg font-semibold text-slate-100" title={region.name}>
					{region.name}
				</div>
			</div>

			<div className="space-y-4">
				{clipSettings && <MediaClipSettingsPanel {...clipSettings} />}
				{onFillCanvas && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full gap-2"
						onClick={onFillCanvas}
					>
						<Maximize2 className="h-3.5 w-3.5" />
						{t("mediaClip.fillCanvas")}
					</Button>
				)}
				<section className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
					<div className="mb-2 text-xs font-semibold text-slate-200">
						{t("videoComponents.display")}
					</div>
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={() => onAppearanceChange({ fitMode: "cover" })}
							className={cn(
								"flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-all",
								fitMode === "cover"
									? "border-[#34B27B] bg-[#34B27B]/15 text-[#34B27B]"
									: "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10",
							)}
						>
							<Maximize2 className="h-4 w-4" />
							{t("videoComponents.fillFrame")}
						</button>
						<button
							type="button"
							onClick={() => onAppearanceChange({ fitMode: "contain", cropZoom: 1 })}
							className={cn(
								"flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-all",
								fitMode === "contain"
									? "border-[#34B27B] bg-[#34B27B]/15 text-[#34B27B]"
									: "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10",
							)}
						>
							<Minimize2 className="h-4 w-4" />
							{t("videoComponents.fitFrame")}
						</button>
					</div>
				</section>

				<section className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
					<label
						className="mb-2 block text-xs font-semibold text-slate-200"
						htmlFor="video-frame-ratio"
					>
						{t("videoComponents.frameRatio")}
					</label>
					<select
						id="video-frame-ratio"
						value={frameAspectRatio}
						onChange={(event) => onAspectRatioChange(event.target.value as VideoRegionAspectRatio)}
						className="h-9 w-full rounded-md border border-white/10 bg-[#1a1a1f] px-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/50"
					>
						{ASPECT_RATIO_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option === "source"
									? t("videoComponents.sourceRatio")
									: option === "free"
										? t("crop.free")
										: option}
							</option>
						))}
					</select>
				</section>

				<section className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
					<div className="mb-3 flex items-center gap-2">
						<Crop className="h-4 w-4 text-[#34B27B]" />
						<span className="text-xs font-semibold text-slate-200">
							{t("videoComponents.cropPosition")}
						</span>
					</div>
					<div className="mx-auto grid w-24 grid-cols-3 gap-1">
						{CROP_POSITION_PRESETS.map((position) => {
							const active = cropPosition.x === position.x && cropPosition.y === position.y;
							return (
								<button
									type="button"
									key={`${position.x}-${position.y}`}
									aria-label={`${t("videoComponents.cropPosition")} ${position.x}, ${position.y}`}
									onClick={() => onAppearanceChange({ cropPosition: position })}
									className={cn(
										"h-7 rounded border transition-all",
										active
											? "border-[#34B27B] bg-[#34B27B]/35"
											: "border-white/10 bg-white/5 hover:bg-white/10",
									)}
								/>
							);
						})}
					</div>

					<div className="mt-4 space-y-3">
						{(["x", "y"] as const).map((axis) => (
							<div key={axis}>
								<div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-400">
									<span>{axis.toUpperCase()}</span>
									<span className="font-mono">{Math.round(cropPosition[axis])}%</span>
								</div>
								<Slider
									value={[cropPosition[axis]]}
									onValueChange={([value]) =>
										onAppearancePreview({
											cropPosition: { ...cropPosition, [axis]: value },
										})
									}
									onValueCommit={onAppearanceCommit}
									min={0}
									max={100}
									step={1}
								/>
							</div>
						))}
					</div>

					<div className="mt-4">
						<div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-400">
							<span>{t("videoComponents.cropZoom")}</span>
							<span className="font-mono">{cropZoom.toFixed(2)}×</span>
						</div>
						<Slider
							value={[cropZoom]}
							onValueChange={([value]) =>
								onAppearancePreview({ fitMode: "cover", cropZoom: value })
							}
							onValueCommit={onAppearanceCommit}
							min={1}
							max={4}
							step={0.05}
						/>
					</div>

					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							onAppearanceChange({
								fitMode: "cover",
								cropPosition: { x: 50, y: 50 },
								cropZoom: 1,
							})
						}
						className="mt-4 w-full gap-2 border-white/10 bg-white/5 text-slate-300"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						{t("videoComponents.resetCrop")}
					</Button>
				</section>
			</div>

			<Button
				type="button"
				variant="destructive"
				size="sm"
				onClick={onDelete}
				className="mt-4 w-full gap-2 border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
			>
				<Trash2 className="h-4 w-4" />
				{t("videoComponents.delete")}
			</Button>
		</div>
	);
}
