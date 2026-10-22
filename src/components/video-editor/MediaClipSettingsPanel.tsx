import { Scissors, Volume2, VolumeX } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { MediaClipTiming } from "@/lib/mediaClipTiming";

export type MediaClipPatch = Partial<
	Pick<MediaClipTiming, "startMs" | "endMs" | "sourceStartMs" | "volume" | "fadeInMs" | "fadeOutMs">
>;

export interface MediaClipSettingsProps {
	clip: MediaClipTiming;
	currentTime: number;
	timelineDuration: number;
	onChange: (patch: MediaClipPatch) => void;
	onSplit: () => void;
}

function ClipNumberField({
	label,
	value,
	max,
	onCommit,
}: {
	label: string;
	value: number;
	max: number;
	onCommit: (value: number) => void;
}) {
	const id = useId();
	const cancelCommit = useRef(false);
	const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
	useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
	return (
		<label htmlFor={id} className="block text-xs text-slate-400">
			{label}
			<input
				id={id}
				type="number"
				min={0}
				max={max}
				step={0.1}
				value={draft}
				className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#1a1a1f] px-2 text-slate-200"
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") {
						cancelCommit.current = true;
						event.currentTarget.blur();
					}
				}}
				onBlur={() => {
					if (cancelCommit.current) {
						cancelCommit.current = false;
						setDraft(String(value));
						return;
					}
					const next = draft.trim() ? Number(draft) : NaN;
					if (Number.isFinite(next) && next >= 0) {
						const clamped = Math.min(max, next);
						setDraft(String(clamped));
						if (clamped !== value) onCommit(clamped);
					} else setDraft(String(value));
				}}
			/>
		</label>
	);
}

export function MediaClipSettingsPanel({
	clip,
	currentTime,
	timelineDuration,
	onChange,
	onSplit,
}: MediaClipSettingsProps) {
	const t = useScopedT("settings");
	const duration = (clip.endMs - clip.startMs) / 1000;
	const sourceStart = (clip.sourceStartMs ?? 0) / 1000;
	const sourceDuration = clip.sourceDurationMs ? clip.sourceDurationMs / 1000 : Infinity;
	const volume = clip.volume ?? 1;
	const canSplit =
		currentTime * 1000 >= clip.startMs + 100 && currentTime * 1000 <= clip.endMs - 100;
	return (
		<section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
			<div className="text-xs font-semibold text-slate-200">{t("mediaClip.timing")}</div>
			<ClipNumberField
				label={t("mediaClip.start")}
				value={clip.startMs / 1000}
				max={Math.max(0, timelineDuration - duration)}
				onCommit={(seconds) =>
					onChange({
						startMs: Math.round(seconds * 1000),
						endMs: Math.round(seconds * 1000) + clip.endMs - clip.startMs,
					})
				}
			/>
			<div className="grid grid-cols-2 gap-2">
				<ClipNumberField
					label={t("mediaClip.sourceStart")}
					value={sourceStart}
					max={Math.max(0, sourceDuration - 0.001)}
					onCommit={(seconds) => onChange({ sourceStartMs: Math.round(seconds * 1000) })}
				/>
				<ClipNumberField
					label={t("mediaClip.duration")}
					value={duration}
					max={Math.max(
						0.001,
						Math.min(sourceDuration - sourceStart, timelineDuration - clip.startMs / 1000),
					)}
					onCommit={(seconds) =>
						onChange({ endMs: clip.startMs + Math.max(1, Math.round(seconds * 1000)) })
					}
				/>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full gap-2"
				disabled={!canSplit}
				onClick={onSplit}
			>
				<Scissors className="h-3.5 w-3.5" />
				{t("mediaClip.split")}
			</Button>
			<p className="text-[10px] leading-relaxed text-slate-500">{t("mediaClip.trimHint")}</p>
			<div className="border-t border-white/10 pt-3 text-xs font-semibold text-slate-200">
				{t("mediaClip.audio")}
			</div>
			<div className="grid grid-cols-[1fr_auto] items-end gap-2">
				<ClipNumberField
					label={t("mediaClip.volume")}
					value={volume * 100}
					max={100}
					onCommit={(percent) => onChange({ volume: percent / 100 })}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label={t(volume > 0 ? "mediaClip.mute" : "mediaClip.unmute")}
					onClick={() => onChange({ volume: volume > 0 ? 0 : 1 })}
				>
					{volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<ClipNumberField
					label={t("mediaClip.fadeIn")}
					value={(clip.fadeInMs ?? 0) / 1000}
					max={duration / 2}
					onCommit={(seconds) => onChange({ fadeInMs: Math.round(seconds * 1000) })}
				/>
				<ClipNumberField
					label={t("mediaClip.fadeOut")}
					value={(clip.fadeOutMs ?? 0) / 1000}
					max={duration / 2}
					onCommit={(seconds) => onChange({ fadeOutMs: Math.round(seconds * 1000) })}
				/>
			</div>
		</section>
	);
}
