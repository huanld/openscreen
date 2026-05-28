import { KeyRound, ListChecks, RefreshCw, Save, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import type {
	GuideAiProvider,
	GuideAiSettings,
	GuideLanguage,
	GuideOcrProfile,
	GuideSession,
} from "@/guide/contracts";
import { captureGuideSnapshots } from "@/guide/snapshot/extractGuideSnapshots";

interface GuidePanelProps {
	recordingId: number | string | null;
	videoPath: string | null;
	videoSourcePath: string | null;
	currentTimeMs: number;
}

type BusyAction = "load" | "generate";

const COPY = {
	en: {
		title: "Guide",
		noRecording: "Record with Guide Mode to create a step guide.",
		noSession: "No guide session yet.",
		generateGuide: "Generate guide",
		generating: "Generating...",
		prepare: "Prepare",
		snapshots: "Snapshots",
		ocr: "OCR",
		draft: "Draft",
		deepseek: "DeepSeek",
		local: "Local",
		exportMd: "MD",
		exportHtml: "HTML",
		events: "events",
		shots: "shots",
		text: "text",
		steps: "steps",
		captureStep: "Capture step",
		captureLabel: "Manual capture",
		settings: "Settings",
		guideSettings: "Guide settings",
		apiKey: "API key env",
		apiKeyPlaceholder: "DEEPSEEK_API_KEY",
		baseUrl: "Base URL",
		model: "Model",
		ocrProfile: "OCR profile",
		ocrLanguage: "OCR languages",
		ocrFast: "Fast Latin",
		ocrVietnamese: "Vietnamese Enhanced",
		ocrHybrid: "Hybrid Vi + Latin",
		saveSettings: "Save",
		clearKey: "Reset env",
		settingsSaved: "Guide settings saved.",
		keyMissing: "Set a DeepSeek API key environment variable before generating with DeepSeek.",
		keyConfigured: "Env ready",
		keyNotConfigured: "Env value missing",
		ready: "Guide artifacts are ready.",
		noEvents: "No click events were captured for this guide.",
		ocrUnavailable: "Local OCR service is unavailable. You can still create a local draft.",
		exported: "Guide exported",
	},
	vi: {
		title: "Hướng dẫn",
		noRecording: "Hãy quay bằng Guide Mode để tạo hướng dẫn từng bước.",
		noSession: "Chưa có guide session.",
		generateGuide: "Tạo hướng dẫn",
		generating: "Đang tạo...",
		prepare: "Chuẩn bị",
		snapshots: "Ảnh",
		ocr: "OCR",
		draft: "Draft",
		deepseek: "DeepSeek",
		local: "Local",
		exportMd: "MD",
		exportHtml: "HTML",
		events: "events",
		shots: "ảnh",
		text: "text",
		steps: "steps",
		captureStep: "Chụp bước",
		captureLabel: "Chụp thủ công",
		settings: "Cài đặt",
		guideSettings: "Guide settings",
		apiKey: "API key env",
		apiKeyPlaceholder: "DEEPSEEK_API_KEY",
		baseUrl: "Base URL",
		model: "Model",
		ocrProfile: "OCR profile",
		ocrLanguage: "OCR languages",
		ocrFast: "Fast Latin",
		ocrVietnamese: "Vietnamese Enhanced",
		ocrHybrid: "Hybrid Vi + Latin",
		saveSettings: "Lưu",
		clearKey: "Reset env",
		settingsSaved: "Da luu cai dat guide.",
		keyMissing: "Hãy set biến môi trường DeepSeek API key trước khi tạo draft bằng DeepSeek.",
		keyConfigured: "Env ready",
		keyNotConfigured: "Chưa thấy giá trị env",
		ready: "Đã sẵn sàng tài liệu hướng dẫn.",
		noEvents: "Chưa ghi nhận click event nào cho guide này.",
		ocrUnavailable: "OCR local chưa chạy. Vẫn có thể tạo draft local.",
		exported: "Đã export hướng dẫn",
	},
} as const;

export function GuidePanel({ recordingId, videoPath, videoSourcePath }: GuidePanelProps) {
	const { locale } = useI18n();
	const copy = useMemo(() => (locale.startsWith("vi") ? COPY.vi : COPY.en), [locale]);
	const guideLanguage: GuideLanguage = locale.startsWith("vi") ? "vi" : "en";
	const [session, setSession] = useState<GuideSession | null>(null);
	const [provider, setProvider] = useState<GuideAiProvider>("local");
	const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
	const [aiSettings, setAiSettings] = useState<GuideAiSettings | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsBusy, setSettingsBusy] = useState(false);
	const [deepSeekApiKeyEnvName, setDeepSeekApiKeyEnvName] = useState("DEEPSEEK_API_KEY");
	const [deepSeekBaseUrl, setDeepSeekBaseUrl] = useState("https://api.deepseek.com");
	const [deepSeekModel, setDeepSeekModel] = useState("deepseek-chat");
	const [ocrProfile, setOcrProfile] = useState<GuideOcrProfile>("vietnamese");
	const [ocrLanguage, setOcrLanguage] = useState("vi,en");
	const [message, setMessage] = useState<string | null>(null);

	const isBusy = busyAction !== null;
	const canUseGuide = Boolean(recordingId && videoSourcePath && window.electronAPI?.guide);
	const generatedSteps = session?.generatedGuide?.steps ?? [];
	const statusLabel = useMemo(() => {
		if (!session) {
			return copy.noSession;
		}
		return [
			`${session.events.length} ${copy.events}`,
			`${session.snapshots.length} ${copy.shots}`,
			`${session.ocrBlocks.length} ${copy.text}`,
			`${generatedSteps.length} ${copy.steps}`,
		].join(" / ");
	}, [copy, generatedSteps.length, session]);

	const loadAiSettings = useCallback(async () => {
		if (!window.electronAPI?.guide?.getAiSettings) {
			return;
		}
		const result = await window.electronAPI.guide.getAiSettings();
		if (!result.success) {
			setMessage(result.error);
			return;
		}
		setAiSettings(result.data);
		setDeepSeekBaseUrl(result.data.deepseek.baseUrl);
		setDeepSeekModel(result.data.deepseek.model);
		setDeepSeekApiKeyEnvName(result.data.deepseek.apiKeyEnvName);
		setOcrProfile(result.data.ocr.profile);
		setOcrLanguage(result.data.ocr.language);
	}, []);

	useEffect(() => {
		void loadAiSettings();
	}, [loadAiSettings]);

	const loadSession = useCallback(async () => {
		if (!recordingId || !window.electronAPI?.guide) {
			setSession(null);
			setBusyAction(null);
			return;
		}

		setBusyAction("load");
		const result = await window.electronAPI.guide.readSession(recordingId);
		setBusyAction(null);
		if (result.success) {
			setSession(result.data);
			setMessage(null);
			return;
		}
		if (result.code === "guide-session-not-found") {
			setSession(null);
			setMessage(null);
			return;
		}
		setMessage(result.error);
	}, [recordingId]);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			if (!recordingId || !window.electronAPI?.guide) {
				setSession(null);
				setBusyAction(null);
				return;
			}
			setBusyAction("load");
			const result = await window.electronAPI.guide.readSession(recordingId);
			if (cancelled) {
				return;
			}
			setBusyAction(null);
			if (result.success) {
				setSession(result.data);
				setMessage(null);
			} else if (result.code === "guide-session-not-found") {
				setSession(null);
				setMessage(null);
			} else {
				setMessage(result.error);
			}
		}
		load();
		return () => {
			cancelled = true;
		};
	}, [recordingId]);

	const ensureEventsSession = useCallback(async (): Promise<GuideSession> => {
		if (!recordingId || !videoSourcePath) {
			throw new Error(copy.noRecording);
		}

		let current = session;
		if (!current) {
			const startResult = await window.electronAPI.guide.startSession(recordingId);
			if (!startResult.success) {
				throw new Error(startResult.error);
			}
			current = startResult.data;
		}

		if (current.status === "recording" || current.videoPath !== videoSourcePath) {
			const finalizeResult = await window.electronAPI.guide.finalizeEvents({
				recordingId,
				videoPath: videoSourcePath,
			});
			if (!finalizeResult.success) {
				throw new Error(finalizeResult.error);
			}
			current = finalizeResult.data;
		}

		setSession(current);
		return current;
	}, [copy.noRecording, recordingId, session, videoSourcePath]);

	const runAction = useCallback(
		async (action: BusyAction, task: () => Promise<void>) => {
			if (!canUseGuide) {
				setMessage(copy.noRecording);
				return;
			}
			setBusyAction(action);
			setMessage(null);
			try {
				await task();
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				setMessage(text);
				toast.error(text);
			} finally {
				setBusyAction(null);
			}
		},
		[canUseGuide, copy.noRecording],
	);

	const handleProviderChange = useCallback(
		(nextProvider: GuideAiProvider) => {
			setProvider(nextProvider);
			if (nextProvider === "deepseek" && !aiSettings?.deepseek.hasApiKey) {
				setSettingsOpen(true);
				setMessage(copy.keyMissing);
			}
		},
		[aiSettings?.deepseek.hasApiKey, copy.keyMissing],
	);

	const handleSaveAiSettings = useCallback(async () => {
		if (!window.electronAPI?.guide?.saveAiSettings) {
			return;
		}
		setSettingsBusy(true);
		setMessage(null);
		try {
			const result = await window.electronAPI.guide.saveAiSettings({
				deepseekApiKeyEnvName: deepSeekApiKeyEnvName,
				baseUrl: deepSeekBaseUrl,
				model: deepSeekModel,
				ocrProfile,
				ocrLanguage,
			});
			if (!result.success) {
				throw new Error(result.error);
			}
			setAiSettings(result.data);
			setDeepSeekApiKeyEnvName(result.data.deepseek.apiKeyEnvName);
			setDeepSeekBaseUrl(result.data.deepseek.baseUrl);
			setDeepSeekModel(result.data.deepseek.model);
			setOcrProfile(result.data.ocr.profile);
			setOcrLanguage(result.data.ocr.language);
			toast.success(copy.settingsSaved);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			setMessage(text);
			toast.error(text);
		} finally {
			setSettingsBusy(false);
		}
	}, [
		copy.settingsSaved,
		deepSeekApiKeyEnvName,
		deepSeekBaseUrl,
		deepSeekModel,
		ocrLanguage,
		ocrProfile,
	]);

	const handleClearDeepSeekKey = useCallback(async () => {
		if (!window.electronAPI?.guide?.saveAiSettings) {
			return;
		}
		setSettingsBusy(true);
		setMessage(null);
		try {
			const result = await window.electronAPI.guide.saveAiSettings({
				clearDeepseekApiKeyEnvName: true,
				baseUrl: deepSeekBaseUrl,
				model: deepSeekModel,
				ocrProfile,
				ocrLanguage,
			});
			if (!result.success) {
				throw new Error(result.error);
			}
			setAiSettings(result.data);
			setDeepSeekApiKeyEnvName(result.data.deepseek.apiKeyEnvName);
			setOcrProfile(result.data.ocr.profile);
			setOcrLanguage(result.data.ocr.language);
			toast.success(copy.settingsSaved);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			setMessage(text);
			toast.error(text);
		} finally {
			setSettingsBusy(false);
		}
	}, [copy.settingsSaved, deepSeekBaseUrl, deepSeekModel, ocrLanguage, ocrProfile]);

	const handleGenerateGuide = useCallback(() => {
		void runAction("generate", async () => {
			if (provider === "deepseek" && !aiSettings?.deepseek.hasApiKey) {
				setSettingsOpen(true);
				throw new Error(copy.keyMissing);
			}
			if (!videoPath) {
				throw new Error("Video URL is not available.");
			}
			let current = await ensureEventsSession();
			if (current.events.length === 0) {
				throw new Error(copy.noEvents);
			}
			if (current.snapshots.length < current.events.length) {
				current = await captureGuideSnapshots({
					session: current,
					videoUrl: videoPath,
					maxWidth: 1280,
				});
				setSession(current);
			}
			const ocrCompletedSnapshotIds = new Set(current.ocrBlocks.map((block) => block.snapshotId));
			const hasPendingOcr = current.snapshots.some(
				(snapshot) => !snapshot.ocrCompletedAt && !ocrCompletedSnapshotIds.has(snapshot.id),
			);
			if (hasPendingOcr) {
				const ocrResult = await window.electronAPI.guide.runOcr({
					recordingId: current.recordingId,
				});
				if (!ocrResult.success) {
					if (ocrResult.code === "guide-ocr-unavailable") {
						toast.warning(copy.ocrUnavailable);
					}
					throw new Error(ocrResult.error);
				}
				current = ocrResult.data;
				setSession(current);
			}
			const result = await window.electronAPI.guide.generateDraft({
				recordingId: current.recordingId,
				language: guideLanguage,
				provider,
			});
			if (!result.success) {
				throw new Error(result.error);
			}
			const markdownResult = await window.electronAPI.guide.exportMarkdown({
				recordingId: current.recordingId,
			});
			if (!markdownResult.success) {
				throw new Error(markdownResult.error);
			}
			const htmlResult = await window.electronAPI.guide.exportHtml({
				recordingId: current.recordingId,
			});
			if (!htmlResult.success) {
				throw new Error(htmlResult.error);
			}
			const revealResult = await window.electronAPI.revealInFolder(htmlResult.data.path);
			if (!revealResult.success) {
				toast.warning(revealResult.error ?? "Unable to open guide folder.");
			}
			setSession(htmlResult.data.session);
			toast.success(copy.exported, {
				description: `${markdownResult.data.path}\n${htmlResult.data.path}`,
			});
		});
	}, [
		aiSettings?.deepseek.hasApiKey,
		copy.exported,
		copy.keyMissing,
		copy.noEvents,
		copy.ocrUnavailable,
		ensureEventsSession,
		guideLanguage,
		provider,
		runAction,
		videoPath,
	]);

	return (
		<section className="editor-inspector-shell flex max-h-[320px] min-h-[246px] shrink-0 flex-col overflow-hidden rounded-[18px] border border-white/[0.075] bg-[#090a0c]">
			<div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<ListChecks className="h-4 w-4 shrink-0 text-[#34B27B]" />
					<span className="truncate text-sm font-semibold text-slate-100">{copy.title}</span>
				</div>
				<button
					type="button"
					title="Reload guide session"
					disabled={isBusy || !recordingId}
					onClick={loadSession}
					className="flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-slate-500 transition-all hover:border-white/10 hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<RefreshCw className={`h-3.5 w-3.5 ${busyAction === "load" ? "animate-spin" : ""}`} />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
				<p className="mb-2 text-[11px] leading-4 text-slate-400">
					{canUseGuide ? statusLabel : copy.noRecording}
				</p>
				{message && <p className="mb-2 text-[11px] leading-4 text-amber-300">{message}</p>}

				<div className="mb-2 flex items-center gap-1.5">
					<select
						value={provider}
						onChange={(event) => handleProviderChange(event.target.value as GuideAiProvider)}
						className="h-8 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[11px] font-medium text-slate-200 outline-none"
						disabled={isBusy}
					>
						<option value="local">{copy.local}</option>
						<option value="deepseek">{copy.deepseek}</option>
					</select>
					<Button
						type="button"
						size="sm"
						title={copy.settings}
						disabled={isBusy}
						onClick={() => setSettingsOpen((current) => !current)}
						className="h-8 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[11px] text-slate-200 hover:bg-white/[0.08]"
					>
						<KeyRound className="h-3.5 w-3.5" />
					</Button>
				</div>

				<button
					type="button"
					disabled={!canUseGuide || isBusy}
					onClick={handleGenerateGuide}
					className="mb-2 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[#34B27B]/35 bg-[#34B27B]/20 px-3 text-sm font-semibold text-[#B9F5D2] transition-all hover:border-[#34B27B]/55 hover:bg-[#34B27B]/28 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<Wand2
						className={`h-4 w-4 shrink-0 ${busyAction === "generate" ? "animate-pulse" : ""}`}
					/>
					<span className="truncate">
						{busyAction === "generate" ? copy.generating : copy.generateGuide}
					</span>
				</button>

				{settingsOpen && (
					<div className="mb-2 space-y-2 rounded-md border border-white/[0.07] bg-white/[0.035] p-2">
						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">
								<div className="truncate text-[11px] font-semibold text-slate-100">
									{copy.guideSettings}
								</div>
								<div className="truncate text-[10px] text-slate-500">
									{aiSettings?.deepseek.hasApiKey
										? `${copy.keyConfigured}: ${aiSettings.deepseek.apiKeyEnvName}`
										: `${copy.keyNotConfigured}: ${
												aiSettings?.deepseek.apiKeyEnvName ?? "DEEPSEEK_API_KEY"
											}`}
								</div>
							</div>
							<span className="shrink-0 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-slate-500">
								{aiSettings?.deepseek.storage ?? "none"}
							</span>
						</div>

						<div className="grid grid-cols-2 gap-1.5">
							<label className="block min-w-0 text-[10px] font-medium text-slate-400">
								{copy.ocrProfile}
								<select
									value={ocrProfile}
									onChange={(event) => setOcrProfile(event.target.value as GuideOcrProfile)}
									disabled={settingsBusy}
									className="mt-1 h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[11px] text-slate-100 outline-none"
								>
									<option value="vietnamese">{copy.ocrVietnamese}</option>
									<option value="hybrid">{copy.ocrHybrid}</option>
									<option value="fast">{copy.ocrFast}</option>
								</select>
							</label>
							<label className="block min-w-0 text-[10px] font-medium text-slate-400">
								{copy.ocrLanguage}
								<input
									type="text"
									value={ocrLanguage}
									onChange={(event) => setOcrLanguage(event.target.value)}
									placeholder="vi,en"
									disabled={settingsBusy}
									className="mt-1 h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
								/>
							</label>
						</div>

						<label className="block text-[10px] font-medium text-slate-400">
							{copy.apiKey}
							<input
								type="text"
								value={deepSeekApiKeyEnvName}
								onChange={(event) => setDeepSeekApiKeyEnvName(event.target.value)}
								placeholder={copy.apiKeyPlaceholder}
								disabled={settingsBusy}
								className="mt-1 h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
							/>
						</label>

						<div className="grid grid-cols-2 gap-1.5">
							<label className="block min-w-0 text-[10px] font-medium text-slate-400">
								{copy.baseUrl}
								<input
									type="text"
									value={deepSeekBaseUrl}
									onChange={(event) => setDeepSeekBaseUrl(event.target.value)}
									disabled={settingsBusy}
									className="mt-1 h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[11px] text-slate-100 outline-none"
								/>
							</label>
							<label className="block min-w-0 text-[10px] font-medium text-slate-400">
								{copy.model}
								<input
									type="text"
									value={deepSeekModel}
									onChange={(event) => setDeepSeekModel(event.target.value)}
									disabled={settingsBusy}
									className="mt-1 h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[11px] text-slate-100 outline-none"
								/>
							</label>
						</div>

						<div className="flex items-center gap-1.5">
							<Button
								type="button"
								size="sm"
								disabled={settingsBusy}
								onClick={handleSaveAiSettings}
								className="h-8 rounded-md border border-white/[0.08] bg-[#34B27B]/15 px-2 text-[11px] text-[#9BE7BF] hover:bg-[#34B27B]/25"
							>
								<Save className="h-3.5 w-3.5" />
								{copy.saveSettings}
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={settingsBusy || !aiSettings?.deepseek.hasApiKey}
								onClick={handleClearDeepSeekKey}
								className="h-8 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[11px] text-slate-200 hover:bg-white/[0.08]"
							>
								<Trash2 className="h-3.5 w-3.5" />
								{copy.clearKey}
							</Button>
						</div>
					</div>
				)}

				<div className="space-y-1.5">
					{generatedSteps.slice(0, 4).map((step) => (
						<div
							key={step.id}
							className="rounded-md border border-white/[0.06] bg-white/[0.035] px-2 py-1.5"
						>
							<div className="truncate text-[11px] font-semibold text-slate-100">
								{step.order}. {step.title}
							</div>
							<p className="line-clamp-2 text-[10px] leading-4 text-slate-400">
								{step.instruction}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
