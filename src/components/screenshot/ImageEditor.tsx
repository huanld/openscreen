import type Konva from "konva";
import {
	ArrowLeft,
	ArrowUpRight,
	Check,
	Copy,
	Crop,
	Download,
	Eye,
	EyeOff,
	MousePointer2,
	Pencil,
	Redo2,
	RotateCw,
	ScanText,
	Shield,
	Square,
	Trash2,
	Type,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Arrow,
	Image as CanvasImage,
	Circle,
	Group,
	Layer,
	Line,
	Rect,
	Stage,
	Text,
	Transformer,
} from "react-konva";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import type { ScreenshotOcrBlock, ScreenshotOcrResult } from "@/native/contracts";
import {
	ANNOTATION_HANDLE_NAME,
	ANNOTATION_NAME,
	type Annotation,
	type AnnotationOrder,
	annotationHandles,
	type CropRect,
	clampCrop,
	clearsSelection,
	cropAnnotations,
	duplicateAnnotation,
	type EditorDocument,
	type EditorTool,
	encodeImage,
	exportImageCanvas,
	limitHistory,
	normalizeRotation,
	nudgeAnnotation,
	placeAnnotation,
	reorderAnnotation,
	resizeAnnotation,
	rotateAnnotations,
	transformAnnotation,
} from "./editorDocument";
import ImageAnnotationInspector, { type AnnotationPropertyPatch } from "./ImageAnnotationInspector";
import styles from "./ImageEditor.module.css";
import OcrTextOverlay from "./OcrTextOverlay";

export interface ImageEditorProps {
	image: { dataUrl: string; width: number; height: number; name: string };
	onSave: (dataUrl: string, format: "png" | "jpeg") => Promise<boolean>;
	onCopy: (dataUrl: string) => Promise<void>;
	onRecognize: (dataUrl: string) => Promise<ScreenshotOcrResult>;
	onBack: () => void;
}

/** Shared so the rendered text and its measured width cannot drift apart. */
const TEXT_FONT_FAMILY = "Arial, sans-serif";

function textEditorBackground(color: string): string {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
	if (!match) return "#111315";
	const [, red, green, blue] = match;
	const luminance =
		(0.2126 * Number.parseInt(red, 16) +
			0.7152 * Number.parseInt(green, 16) +
			0.0722 * Number.parseInt(blue, 16)) /
		255;
	return luminance < 0.45 ? "#f8fafc" : "#111315";
}

const TOOL_ICONS = {
	select: MousePointer2,
	crop: Crop,
	pen: Pencil,
	rectangle: Square,
	arrow: ArrowUpRight,
	text: Type,
	redact: Shield,
} as const;

function AnnotationShape({
	annotation,
	selectable,
	onSelect,
	onPlace,
	onEdit,
}: {
	annotation: Annotation;
	selectable: boolean;
	onSelect: (id: string) => void;
	onPlace: (id: string, x: number, y: number, rotation: number) => void;
	onEdit?: (id: string) => void;
}) {
	const common = {
		id: annotation.id,
		name: ANNOTATION_NAME,
		x: annotation.x,
		y: annotation.y,
		rotation: annotation.rotation,
		listening: selectable,
		draggable: selectable,
		onClick: () => onSelect(annotation.id),
		onTap: () => onSelect(annotation.id),
		onDragStart: () => onSelect(annotation.id),
		onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
			onPlace(annotation.id, event.target.x(), event.target.y(), annotation.rotation),
	};
	if (annotation.kind === "text") {
		return (
			<Text
				{...common}
				text={annotation.text}
				fontSize={annotation.fontSize}
				fontFamily={TEXT_FONT_FAMILY}
				fill={annotation.color}
				lineHeight={1.2}
				onDblClick={() => onEdit?.(annotation.id)}
				onDblTap={() => onEdit?.(annotation.id)}
			/>
		);
	}
	if (annotation.kind === "rectangle" || annotation.kind === "redact") {
		return (
			<Rect
				{...common}
				width={annotation.width}
				height={annotation.height}
				fill={annotation.kind === "redact" ? "#000000" : undefined}
				stroke={annotation.kind === "redact" ? undefined : annotation.color}
				strokeWidth={annotation.kind === "redact" ? 0 : annotation.strokeWidth}
				hitStrokeWidth={Math.max(16, annotation.strokeWidth)}
			/>
		);
	}
	const line = {
		...common,
		points: annotation.points,
		stroke: annotation.color,
		strokeWidth: annotation.strokeWidth,
		lineCap: "round" as const,
		lineJoin: "round" as const,
		hitStrokeWidth: Math.max(16, annotation.strokeWidth),
	};
	return annotation.kind === "arrow" ? (
		<Arrow
			{...line}
			fill={annotation.color}
			pointerLength={annotation.strokeWidth * 4}
			pointerWidth={annotation.strokeWidth * 4}
		/>
	) : (
		<Line {...line} />
	);
}

export default function ImageEditor(props: ImageEditorProps) {
	return <ImageEditorSession key={props.image.dataUrl} {...props} />;
}

function ImageEditorSession({ image, onSave, onCopy, onRecognize, onBack }: ImageEditorProps) {
	const t = useScopedT("screenshot");
	const [history, setHistory] = useState(() => ({
		past: [] as EditorDocument[],
		present: { ...image, id: crypto.randomUUID(), annotations: [] } as EditorDocument,
		future: [] as EditorDocument[],
	}));
	const current = history.present;
	const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null);
	const [tool, setTool] = useState<EditorTool>("select");
	const [color, setColor] = useState("#ef4444");
	const [strokeWidth, setStrokeWidth] = useState(Math.max(4, Math.round(image.width / 500)));
	const [fontSize, setFontSize] = useState(Math.max(24, Math.round(image.width / 60)));
	const [text, setText] = useState("");
	const [format, setFormat] = useState<"png" | "jpeg">("png");
	const [draft, setDraft] = useState<Annotation | null>(null);
	const [crop, setCrop] = useState<CropRect | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editingTextId, setEditingTextId] = useState<string | null>(null);
	const [inlineText, setInlineText] = useState("");
	const [handlePreview, setHandlePreview] = useState<Annotation | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [savedId, setSavedId] = useState<string | null>(null);
	const [showDiscard, setShowDiscard] = useState(false);
	const [ocrBlocks, setOcrBlocks] = useState<ScreenshotOcrBlock[]>([]);
	const [ocrVisible, setOcrVisible] = useState(false);
	const [ocrLoading, setOcrLoading] = useState(false);
	const [leaveIntent, setLeaveIntent] = useState<"back" | "close">("back");
	const [viewport, setViewport] = useState({ width: 800, height: 500 });
	const viewportRef = useRef<HTMLDivElement>(null);
	const layerRef = useRef<Konva.Layer>(null);
	const stageRef = useRef<Konva.Stage>(null);
	const selectionRef = useRef<Konva.Transformer>(null);
	const gestureRef = useRef<{ x: number; y: number } | null>(null);
	const draftRef = useRef<Annotation | null>(null);
	// The annotation as it looked when a handle drag started, plus the text width
	// measured then. Both stay fixed for the whole drag so repeated moves resolve
	// against the original geometry instead of compounding.
	const handleDragRef = useRef<{ annotation: Annotation; span: number } | null>(null);
	const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const busyRef = useRef(false);
	const allowCloseRef = useRef(false);
	const textInputRef = useRef<HTMLTextAreaElement>(null);
	const inlineTextRef = useRef<HTMLTextAreaElement>(null);
	const ocrRequestRef = useRef(0);
	const ocrInteractionRef = useRef(0);
	const ocrSourceRef = useRef(current.dataUrl);
	if (ocrSourceRef.current !== current.dataUrl) {
		ocrSourceRef.current = current.dataUrl;
		ocrRequestRef.current += 1;
	}
	const scale = Math.min(1, viewport.width / current.width, viewport.height / current.height);
	const loaded = bitmap?.src === current.dataUrl;
	const canEdit = loaded && !busy;
	const selected = current.annotations.find((annotation) => annotation.id === selectedId);
	const editingTextAnnotation = current.annotations.find(
		(annotation) => annotation.id === editingTextId && annotation.kind === "text",
	);
	const normalizedInlineText = inlineText.replace(/\r\n/g, "\n");
	const inlineTextChanged = Boolean(
		editingTextAnnotation && normalizedInlineText !== editingTextAnnotation.text,
	);
	const dirty = savedId !== current.id || inlineTextChanged;
	// The annotation the endpoint handles act on. It follows the live preview while
	// one of the handles is being dragged, so the shape tracks the cursor.
	const selectionAnnotation =
		handlePreview && handlePreview.id === selectedId ? handlePreview : selected;
	const usesEndpointHandles =
		selectionAnnotation?.kind === "arrow" || selectionAnnotation?.kind === "pen";
	const usesStandardTransform =
		selectionAnnotation?.kind === "text" ||
		selectionAnnotation?.kind === "rectangle" ||
		selectionAnnotation?.kind === "redact";
	const selectionHandles =
		selectionAnnotation && usesEndpointHandles && tool === "select" && canEdit
			? annotationHandles(selectionAnnotation, measureTextSpan(selectionAnnotation))
			: null;

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(dirty || busy);
	}, [busy, dirty]);
	useEffect(
		() => () => {
			window.electronAPI.setHasUnsavedChanges(false);
		},
		[],
	);

	useEffect(() => {
		let cancelled = false;
		const next = new window.Image();
		next.onload = () => {
			if (!cancelled) setBitmap(next);
		};
		next.onerror = () => {
			if (!cancelled) setError(t("editor.loadError"));
		};
		next.src = current.dataUrl;
		return () => {
			cancelled = true;
		};
	}, [current.dataUrl, t]);

	useEffect(() => {
		// Keep the request source explicit here as well as during render so this
		// effect documents which image owns the OCR state it clears.
		ocrSourceRef.current = current.dataUrl;
		setOcrBlocks([]);
		setOcrVisible(false);
		setOcrLoading(false);
	}, [current.dataUrl]);
	useEffect(
		() => () => {
			ocrRequestRef.current += 1;
		},
		[],
	);

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			setViewport({
				width: Math.max(1, entry.contentRect.width - 48),
				height: Math.max(1, entry.contentRect.height - 48),
			});
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const node = selectedId ? layerRef.current?.findOne(`#${selectedId}`) : undefined;
		selectionRef.current?.nodes(
			node && tool === "select" && !editingTextId && canEdit ? [node] : [],
		);
		handleDragRef.current = null;
		setHandlePreview(null);
	}, [canEdit, editingTextId, selectedId, tool]);

	useEffect(() => {
		if (!editingTextId) return;
		if (!editingTextAnnotation) {
			setEditingTextId(null);
			return;
		}
		const frame = requestAnimationFrame(() => {
			inlineTextRef.current?.focus();
			inlineTextRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editingTextAnnotation, editingTextId]);

	const resetGesture = useCallback(() => {
		gestureRef.current = null;
		draftRef.current = null;
		setDraft(null);
		setCrop(null);
	}, []);

	const commit = useCallback((next: EditorDocument) => {
		setHistory((previous) => ({
			past: limitHistory([...previous.past, previous.present], next),
			present: { ...next, id: crypto.randomUUID() },
			future: [],
		}));
		setMessage("");
	}, []);

	const commitAnnotations = useCallback(
		(update: (annotations: Annotation[]) => Annotation[] | null) => {
			setHistory((previous) => {
				const annotations = update(previous.present.annotations);
				if (!annotations || annotations === previous.present.annotations) return previous;
				const next = { ...previous.present, annotations };
				return {
					past: limitHistory([...previous.past, previous.present], next),
					present: { ...next, id: crypto.randomUUID() },
					future: [],
				};
			});
			setMessage("");
		},
		[],
	);

	const undo = useCallback(() => {
		resetGesture();
		setSelectedId(null);
		setHistory((previous) => {
			const last = previous.past[previous.past.length - 1];
			return last
				? {
						past: previous.past.slice(0, -1),
						present: last,
						future: [previous.present, ...previous.future],
					}
				: previous;
		});
	}, [resetGesture]);

	const redo = useCallback(() => {
		resetGesture();
		setSelectedId(null);
		setHistory((previous) => {
			const next = previous.future[0];
			return next
				? {
						past: [...previous.past, previous.present],
						present: next,
						future: previous.future.slice(1),
					}
				: previous;
		});
	}, [resetGesture]);

	const deleteSelected = useCallback(() => {
		if (!selectedId) return;
		commit({
			...current,
			annotations: current.annotations.filter((annotation) => annotation.id !== selectedId),
		});
		setSelectedId(null);
	}, [current, selectedId, commit]);

	const duplicateSelected = useCallback(() => {
		if (!selectedId) return;
		const duplicateId = `annotation-${crypto.randomUUID()}`;
		commitAnnotations((annotations) => duplicateAnnotation(annotations, selectedId, duplicateId));
		setSelectedId(duplicateId);
	}, [commitAnnotations, selectedId]);

	const nudgeSelected = useCallback(
		(dx: number, dy: number) => {
			if (!selectedId) return;
			commitAnnotations((annotations) => nudgeAnnotation(annotations, selectedId, dx, dy));
		},
		[commitAnnotations, selectedId],
	);

	const reorderSelected = useCallback(
		(direction: AnnotationOrder) => {
			if (!selectedId) return;
			commitAnnotations((annotations) => reorderAnnotation(annotations, selectedId, direction));
		},
		[commitAnnotations, selectedId],
	);

	const applySelectedProperties = useCallback(
		(patch: AnnotationPropertyPatch) => {
			if (!selectedId) return;
			commitAnnotations((annotations) => {
				let changed = false;
				const nextAnnotations = annotations.map((annotation) => {
					if (annotation.id !== selectedId) return annotation;
					const next = {
						...annotation,
						...patch,
						rotation: normalizeRotation(patch.rotation ?? annotation.rotation),
					};
					changed = (Object.keys(patch) as (keyof Annotation)[]).some(
						(key) => !Object.is(annotation[key], next[key]),
					);
					return changed ? next : annotation;
				});
				return changed ? nextAnnotations : null;
			});
		},
		[commitAnnotations, selectedId],
	);

	function beginInlineTextEdit(id: string) {
		const annotation = current.annotations.find((entry) => entry.id === id);
		if (!canEdit || annotation?.kind !== "text") return;
		setSelectedId(id);
		setTool("select");
		setInlineText(annotation.text);
		setEditingTextId(id);
	}

	const commitInlineTextDraft = useCallback(() => {
		const id = editingTextId;
		const value = inlineText.replace(/\r\n/g, "\n");
		setEditingTextId(null);
		if (!id || !value.trim()) return current.id;
		const source = current.annotations.find(
			(annotation) => annotation.id === id && annotation.kind === "text",
		);
		if (!source || source.text === value) return current.id;
		const nextId = crypto.randomUUID();
		setHistory((previous) => {
			const annotations = previous.present.annotations.map((annotation) =>
				annotation.id === id && annotation.kind === "text"
					? { ...annotation, text: value }
					: annotation,
			);
			const next = { ...previous.present, annotations };
			return {
				past: limitHistory([...previous.past, previous.present], next),
				present: { ...next, id: nextId },
				future: [],
			};
		});
		setMessage("");
		setText(value);
		return nextId;
	}, [current, editingTextId, inlineText]);

	function finishInlineTextEdit(save: boolean) {
		if (save) commitInlineTextDraft();
		else setEditingTextId(null);
	}

	const requestLeave = useCallback(
		(intent: "back" | "close") => {
			if (busyRef.current) {
				if (intent === "close") window.electronAPI.cancelPendingExit();
				return;
			}
			if (dirty) {
				setLeaveIntent(intent);
				setShowDiscard(true);
			} else if (intent === "back") onBack();
			else {
				allowCloseRef.current = true;
				window.close();
			}
		},
		[dirty, onBack],
	);
	const handleDiscardOpenChange = useCallback(
		(open: boolean) => {
			setShowDiscard(open);
			if (!open && leaveIntent === "close" && !allowCloseRef.current) {
				window.electronAPI.cancelPendingExit();
			}
		},
		[leaveIntent],
	);

	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (allowCloseRef.current || (!dirty && !busyRef.current)) return;
			event.preventDefault();
			event.returnValue = "";
			requestLeave("close");
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty, requestLeave]);

	const exportImage = useCallback(
		async (action: "save" | "copy") => {
			if (!layerRef.current || !loaded || busyRef.current) return;
			if (crop || gestureRef.current) {
				setError(t("editor.finishCrop"));
				return;
			}
			busyRef.current = true;
			setBusy(true);
			setError("");
			const exportedDocumentId = commitInlineTextDraft();
			try {
				const canvas = exportImageCanvas(layerRef.current, current.width, current.height);
				if (action === "copy") {
					await onCopy(encodeImage(canvas, "png"));
					setMessage(t("editor.copied"));
				} else if (await onSave(encodeImage(canvas, format), format)) {
					setSavedId(exportedDocumentId);
					setMessage(t("editor.saved"));
				}
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : t("editor.exportError"));
			} finally {
				busyRef.current = false;
				setBusy(false);
			}
		},
		[commitInlineTextDraft, crop, current, format, loaded, onCopy, onSave, t],
	);

	useEffect(() => {
		const api = window.electronAPI;
		const removeSave = api?.onMenuSaveProject?.(() => {
			if (!showDiscard) void exportImage("save");
		});
		const removeSaveAs = api?.onMenuSaveProjectAs?.(() => {
			if (!showDiscard) void exportImage("save");
		});
		const removeLoad = api?.onMenuLoadProject?.(() => requestLeave("back"));
		return () => {
			removeSave?.();
			removeSaveAs?.();
			removeLoad?.();
		};
	}, [exportImage, requestLeave, showDiscard]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest("input, textarea, select, button, [contenteditable=true]") ||
				busy ||
				showDiscard ||
				!loaded
			)
				return;
			const modifier = event.ctrlKey || event.metaKey;
			if (modifier && event.key.toLowerCase() === "z") {
				event.preventDefault();
				event.shiftKey ? redo() : undo();
			} else if (modifier && event.key.toLowerCase() === "y") {
				event.preventDefault();
				redo();
			} else if (modifier && event.key.toLowerCase() === "s") {
				event.preventDefault();
				if (!crop && !gestureRef.current) void exportImage("save");
			} else if (modifier && event.key.toLowerCase() === "d") {
				event.preventDefault();
				duplicateSelected();
			} else if (!modifier && !event.altKey && event.key.startsWith("Arrow")) {
				const distance = event.shiftKey ? 10 : 1;
				const delta = {
					ArrowLeft: [-distance, 0],
					ArrowRight: [distance, 0],
					ArrowUp: [0, -distance],
					ArrowDown: [0, distance],
				}[event.key];
				if (delta && selectedId) {
					event.preventDefault();
					nudgeSelected(delta[0], delta[1]);
				}
			} else if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault();
				deleteSelected();
			} else if (event.key === "Escape") {
				resetGesture();
				setSelectedId(null);
				setTool("select");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		busy,
		crop,
		deleteSelected,
		duplicateSelected,
		exportImage,
		loaded,
		nudgeSelected,
		redo,
		resetGesture,
		selectedId,
		showDiscard,
		undo,
	]);

	function chooseTool(next: EditorTool) {
		ocrInteractionRef.current += 1;
		if (editingTextId) finishInlineTextEdit(true);
		resetGesture();
		setSelectedId(null);
		setTool(next);
		if (next !== "select") setOcrVisible(false);
		if (next === "text") requestAnimationFrame(() => textInputRef.current?.focus());
	}

	async function recognizeText() {
		if (!loaded || busy || ocrLoading || crop || draft) return;
		const requestId = ++ocrRequestRef.current;
		const interactionId = ocrInteractionRef.current;
		const sourceDataUrl = current.dataUrl;
		setOcrLoading(true);
		setError("");
		setMessage("");
		try {
			const result = await onRecognize(sourceDataUrl);
			if (requestId !== ocrRequestRef.current || ocrSourceRef.current !== sourceDataUrl) return;
			setOcrBlocks(result.blocks);
			setOcrVisible(
				result.blocks.length > 0 &&
					tool === "select" &&
					interactionId === ocrInteractionRef.current,
			);
			setMessage(
				result.blocks.length > 0
					? t("editor.ocr.found", { count: result.blocks.length })
					: t("editor.ocr.empty"),
			);
		} catch (failure) {
			if (requestId !== ocrRequestRef.current || ocrSourceRef.current !== sourceDataUrl) return;
			setError(
				failure instanceof Error && failure.message ? failure.message : t("editor.ocr.error"),
			);
		} finally {
			if (requestId === ocrRequestRef.current) setOcrLoading(false);
		}
	}

	function toggleOcrOverlay() {
		if (ocrVisible) {
			setOcrVisible(false);
			return;
		}
		resetGesture();
		setSelectedId(null);
		setTool("select");
		setOcrVisible(true);
	}

	function pointerPosition() {
		const point = stageRef.current?.getPointerPosition();
		if (!point) return null;
		return {
			x: Math.max(0, Math.min(current.width, point.x / scale)),
			y: Math.max(0, Math.min(current.height, point.y / scale)),
		};
	}

	function beginGesture(event: Konva.KonvaEventObject<PointerEvent>) {
		if (!canEdit || event.evt.button > 0) return;
		ocrInteractionRef.current += 1;
		const point = pointerPosition();
		if (!point) return;
		if (tool === "select") {
			if (clearsSelection(event.target.name())) setSelectedId(null);
			return;
		}
		setSelectedId(null);
		setMessage("");
		if (tool === "crop") {
			gestureRef.current = point;
			setCrop(null);
			return;
		}
		const annotation: Annotation = {
			id: `annotation-${crypto.randomUUID()}`,
			kind: tool,
			...point,
			rotation: 0,
			color,
			strokeWidth,
			width: 0,
			height: 0,
			points: [0, 0, 0.01, 0.01],
			text: text.replace(/\r\n/g, "\n"),
			fontSize,
		};
		if (tool === "text") {
			if (!text.trim()) {
				textInputRef.current?.focus();
				return;
			}
			commit({ ...current, annotations: [...current.annotations, annotation] });
			setSelectedId(annotation.id);
			setTool("select");
			return;
		}
		gestureRef.current = point;
		draftRef.current = annotation;
		setDraft(annotation);
	}

	function moveGesture() {
		const start = gestureRef.current;
		const point = pointerPosition();
		if (!start || !point) return;
		if (tool === "crop") {
			setCrop(clampCrop(start, point, current.width, current.height));
			return;
		}
		const drawing = draftRef.current;
		if (!drawing) return;
		const next = { ...drawing };
		if (drawing.kind === "pen")
			next.points = [...drawing.points, point.x - start.x, point.y - start.y];
		else if (drawing.kind === "arrow") next.points = [0, 0, point.x - start.x, point.y - start.y];
		else {
			next.x = Math.min(start.x, point.x);
			next.y = Math.min(start.y, point.y);
			next.width = Math.abs(point.x - start.x);
			next.height = Math.abs(point.y - start.y);
		}
		draftRef.current = next;
		setDraft(next);
	}

	function endGesture() {
		if (!gestureRef.current) return;
		gestureRef.current = null;
		const annotation = draftRef.current;
		draftRef.current = null;
		setDraft(null);
		if (!annotation) return;
		if (
			(annotation.kind === "rectangle" || annotation.kind === "redact") &&
			(annotation.width < 1 || annotation.height < 1)
		)
			return;
		commit({ ...current, annotations: [...current.annotations, annotation] });
	}

	/**
	 * Width of a text annotation, measured the way Konva measures it. Reading the
	 * rendered node instead would lag a render behind the font size and leave the
	 * end handle short of the text after a stretch.
	 */
	function measureTextSpan(annotation: Annotation) {
		if (annotation.kind !== "text") return 0;
		measureCanvasRef.current ??= document.createElement("canvas");
		const context = measureCanvasRef.current.getContext("2d");
		if (!context) return 0;
		context.font = `normal normal ${annotation.fontSize}px ${TEXT_FONT_FAMILY}`;
		return annotation.text
			.split("\n")
			.reduce((widest, line) => Math.max(widest, context.measureText(line).width), 0);
	}

	function beginHandleDrag(annotation: Annotation) {
		handleDragRef.current = { annotation, span: measureTextSpan(annotation) };
	}

	function dragHandle(handle: "start" | "end", x: number, y: number) {
		const drag = handleDragRef.current;
		if (!drag) return;
		setHandlePreview(resizeAnnotation(drag.annotation, handle, { x, y }, drag.span));
	}

	function endHandleDrag(handle: "start" | "end", x: number, y: number) {
		const drag = handleDragRef.current;
		handleDragRef.current = null;
		setHandlePreview(null);
		if (!drag) return;
		const next = resizeAnnotation(drag.annotation, handle, { x, y }, drag.span);
		if (next === drag.annotation) return;
		commit({
			...current,
			annotations: current.annotations.map((annotation) =>
				annotation.id === next.id ? next : annotation,
			),
		});
	}

	function endStandardTransform() {
		const node = selectionRef.current?.nodes()[0];
		if (!selected || !node || !usesStandardTransform) return;
		const next = transformAnnotation(selected, {
			x: node.x(),
			y: node.y(),
			rotation: node.rotation(),
			scaleX: node.scaleX(),
			scaleY: node.scaleY(),
		});
		// Konva keeps scale on the live node. Geometry belongs in the immutable
		// document instead, otherwise a later render would apply the scale twice.
		node.scaleX(1);
		node.scaleY(1);
		if (!next) {
			node.position({ x: selected.x, y: selected.y });
			node.rotation(selected.rotation);
			selectionRef.current?.forceUpdate();
			return;
		}
		commit({
			...current,
			annotations: current.annotations.map((annotation) =>
				annotation.id === next.id ? next : annotation,
			),
		});
	}

	function placeAnnotationAt(id: string, x: number, y: number, rotation: number) {
		const annotations = placeAnnotation(current.annotations, id, { x, y, rotation });
		if (!annotations) return;
		commit({ ...current, annotations });
	}

	function transformImage(operation: "crop" | "rotate") {
		if (!bitmap || !canEdit || (operation === "crop" && !crop)) return;
		try {
			const canvas = document.createElement("canvas");
			canvas.width = operation === "crop" && crop ? crop.width : current.height;
			canvas.height = operation === "crop" && crop ? crop.height : current.width;
			const context = canvas.getContext("2d");
			if (!context) throw new Error(t("editor.exportError"));
			if (operation === "crop" && crop) context.drawImage(bitmap, -crop.x, -crop.y);
			else {
				context.translate(canvas.width, 0);
				context.rotate(Math.PI / 2);
				context.drawImage(bitmap, 0, 0);
			}
			commit({
				...current,
				dataUrl: canvas.toDataURL("image/png"),
				width: canvas.width,
				height: canvas.height,
				annotations:
					operation === "crop" && crop
						? cropAnnotations(current.annotations, crop)
						: rotateAnnotations(current.annotations, current.height),
			});
			resetGesture();
			setSelectedId(null);
			setTool("select");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : t("editor.exportError"));
		}
	}

	const hint = ocrVisible
		? t("editor.ocr.selectHint")
		: tool === "crop"
			? t("editor.cropHint")
			: tool === "text"
				? t("editor.textHint")
				: tool === "redact"
					? t("editor.redactHint")
					: tool === "select"
						? t("editor.selectHint")
						: t("editor.drawHint");

	return (
		<section className={styles.editor} aria-label={t("editor.title")}>
			<header className={styles.header}>
				<button
					type="button"
					className={styles.button}
					onClick={() => requestLeave("back")}
					disabled={busy}
				>
					<ArrowLeft size={17} /> {t("editor.back")}
				</button>
				<div className={styles.fileInfo}>
					<strong title={image.name}>{image.name}</strong>
					<span>
						{current.width} × {current.height} px{" "}
						{dirty ? `· ${t("editor.unsaved")}` : `· ${t("editor.saved")}`}
					</span>
				</div>
				<div className={styles.exportActions}>
					<button
						type="button"
						data-testid="screenshot-copy"
						className={styles.button}
						onClick={() => void exportImage("copy")}
						disabled={!canEdit || !!crop || !!draft}
					>
						<Copy size={17} /> {t("editor.copy")}
					</button>
					<select
						data-testid="screenshot-format"
						className={styles.select}
						aria-label={t("editor.format")}
						value={format}
						disabled={busy}
						onChange={(event) => setFormat(event.target.value as "png" | "jpeg")}
					>
						<option value="png">PNG</option>
						<option value="jpeg">JPEG</option>
					</select>
					<button
						type="button"
						data-testid="screenshot-save"
						className={`${styles.button} ${styles.primary}`}
						onClick={() => void exportImage("save")}
						disabled={!canEdit || !!crop || !!draft}
					>
						<Download size={17} /> {busy ? t("editor.working") : t("editor.save")}
					</button>
				</div>
			</header>
			<div className={styles.toolbar} role="toolbar" aria-label={t("editor.tools")}>
				{(Object.keys(TOOL_ICONS) as EditorTool[]).map((name) => {
					const Icon = TOOL_ICONS[name];
					return (
						<button
							key={name}
							type="button"
							data-testid={`screenshot-tool-${name}`}
							className={`${styles.tool} ${tool === name ? styles.activeTool : ""}`}
							aria-pressed={tool === name}
							disabled={!canEdit}
							onClick={() => chooseTool(name)}
						>
							<Icon size={18} />
							<span>{t(`editor.tool.${name}`)}</span>
						</button>
					);
				})}
				<span className={styles.divider} />
				<button
					type="button"
					data-testid="screenshot-tool-rotate"
					className={styles.tool}
					disabled={!canEdit || !!crop}
					onClick={() => transformImage("rotate")}
				>
					<RotateCw size={18} />
					<span>{t("editor.rotate")}</span>
				</button>
				<span className={styles.divider} />
				<button
					type="button"
					data-testid="screenshot-ocr-run"
					className={styles.tool}
					disabled={!canEdit || !!crop || !!draft || ocrLoading}
					onClick={() => void recognizeText()}
				>
					<ScanText size={18} />
					<span>{t(ocrLoading ? "editor.ocr.running" : "editor.ocr.run")}</span>
				</button>
				{ocrBlocks.length > 0 && (
					<button
						type="button"
						data-testid="screenshot-ocr-toggle"
						className={`${styles.tool} ${ocrVisible ? styles.activeTool : ""}`}
						aria-pressed={ocrVisible}
						disabled={!canEdit}
						onClick={toggleOcrOverlay}
					>
						{ocrVisible ? <EyeOff size={18} /> : <Eye size={18} />}
						<span>{t(ocrVisible ? "editor.ocr.hide" : "editor.ocr.show")}</span>
					</button>
				)}
				<div className={styles.historyActions}>
					<button
						type="button"
						data-testid="screenshot-undo"
						className={styles.iconButton}
						title={t("editor.undo")}
						aria-label={t("editor.undo")}
						disabled={!canEdit || history.past.length === 0}
						onClick={undo}
					>
						<Undo2 size={18} />
					</button>
					<button
						type="button"
						data-testid="screenshot-redo"
						className={styles.iconButton}
						title={t("editor.redo")}
						aria-label={t("editor.redo")}
						disabled={!canEdit || history.future.length === 0}
						onClick={redo}
					>
						<Redo2 size={18} />
					</button>
					<button
						type="button"
						className={styles.iconButton}
						title={t("editor.delete")}
						aria-label={t("editor.delete")}
						disabled={!canEdit || !selectedId}
						onClick={deleteSelected}
					>
						<Trash2 size={18} />
					</button>
				</div>
			</div>
			<div className={styles.options}>
				{tool !== "select" && tool !== "crop" && tool !== "redact" && (
					<>
						<label className={styles.option}>
							{t("editor.color")}
							<input
								type="color"
								aria-label={t("editor.color")}
								value={color}
								disabled={!canEdit}
								onChange={(event) => setColor(event.target.value)}
							/>
						</label>
						{tool !== "text" && (
							<label className={styles.option}>
								{t("editor.stroke")}
								<input
									type="range"
									aria-label={t("editor.stroke")}
									min={1}
									max={32}
									value={strokeWidth}
									disabled={!canEdit}
									onChange={(event) => setStrokeWidth(Number(event.target.value))}
								/>
								<span>{strokeWidth} px</span>
							</label>
						)}
					</>
				)}
				{tool === "text" && (
					<>
						<textarea
							ref={textInputRef}
							data-testid="screenshot-text-input"
							className={styles.textInput}
							aria-label={t("editor.textInput")}
							placeholder={t("editor.textPlaceholder")}
							value={text}
							rows={2}
							maxLength={2000}
							disabled={!canEdit}
							onChange={(event) => setText(event.target.value)}
						/>
						<label className={styles.option}>
							{t("editor.fontSize")}
							<input
								type="number"
								aria-label={t("editor.fontSize")}
								min={8}
								max={240}
								value={fontSize}
								disabled={!canEdit}
								onChange={(event) =>
									setFontSize(Math.max(8, Math.min(240, Number(event.target.value) || 8)))
								}
							/>
						</label>
					</>
				)}
				{selected && tool === "select" && (
					<ImageAnnotationInspector
						annotation={selected}
						canEdit={canEdit}
						index={current.annotations.findIndex((entry) => entry.id === selected.id)}
						count={current.annotations.length}
						onApply={applySelectedProperties}
						onDuplicate={duplicateSelected}
						onReorder={reorderSelected}
					/>
				)}
				{tool === "crop" && (
					<>
						<button
							type="button"
							data-testid="screenshot-crop-apply"
							className={`${styles.button} ${styles.primary}`}
							disabled={!crop || !canEdit}
							onClick={() => transformImage("crop")}
						>
							<Check size={16} />
							{t("editor.applyCrop")}
						</button>
						<button type="button" className={styles.button} onClick={() => chooseTool("select")}>
							<X size={16} />
							{t("editor.cancel")}
						</button>
						{crop && (
							<span className={styles.dimensions}>
								{crop.width} × {crop.height} px
							</span>
						)}
					</>
				)}
				<p className={styles.hint}>{hint}</p>
			</div>
			<div className={styles.viewport} ref={viewportRef}>
				{!loaded && (
					<div className={styles.loading} role="status">
						{t("editor.loading")}
					</div>
				)}
				<div
					className={styles.canvasFrame}
					style={{
						width: current.width * scale,
						height: current.height * scale,
						visibility: loaded ? "visible" : "hidden",
					}}
				>
					<div
						data-testid="screenshot-canvas"
						className={styles.canvas}
						style={{ cursor: tool === "select" ? "default" : "crosshair" }}
						role="img"
						aria-label={t("editor.canvas")}
					>
						<Stage
							ref={stageRef}
							width={current.width * scale}
							height={current.height * scale}
							scaleX={scale}
							scaleY={scale}
							onPointerDown={beginGesture}
							onPointerMove={moveGesture}
							onPointerUp={endGesture}
							onPointerLeave={endGesture}
							onPointerCancel={() => resetGesture()}
						>
							<Layer
								ref={layerRef}
								clipX={0}
								clipY={0}
								clipWidth={current.width}
								clipHeight={current.height}
							>
								<CanvasImage
									image={loaded ? bitmap : undefined}
									width={current.width}
									height={current.height}
								/>
								{current.annotations.map((entry) => {
									const annotation =
										handlePreview && handlePreview.id === entry.id ? handlePreview : entry;
									const renderedAnnotation =
										annotation.id === editingTextId &&
										annotation.kind === "text" &&
										normalizedInlineText.trim()
											? { ...annotation, text: normalizedInlineText }
											: annotation;
									return (
										<AnnotationShape
											key={renderedAnnotation.id}
											annotation={renderedAnnotation}
											selectable={tool === "select" && canEdit}
											onSelect={(id) => {
												setSelectedId(id);
												const item = current.annotations.find((entry) => entry.id === id);
												if (item?.kind === "text") setText(item.text);
											}}
											onPlace={placeAnnotationAt}
											onEdit={beginInlineTextEdit}
										/>
									);
								})}
							</Layer>
							{/* Selection chrome stays on its own layer so export only receives the
							    bitmap and annotations. Standard shapes use familiar resize/rotate
							    controls; vector strokes keep their two meaningful endpoints. */}
							<Layer>
								{draft && (
									<AnnotationShape
										annotation={draft}
										selectable={false}
										onSelect={setSelectedId}
										onPlace={placeAnnotationAt}
									/>
								)}
								<Transformer
									ref={selectionRef}
									name={ANNOTATION_HANDLE_NAME}
									listening={canEdit}
									rotateEnabled={canEdit && usesStandardTransform}
									resizeEnabled={canEdit && usesStandardTransform}
									enabledAnchors={
										selectionAnnotation?.kind === "text"
											? ["top-left", "top-right", "bottom-left", "bottom-right"]
											: usesStandardTransform
												? [
														"top-left",
														"top-center",
														"top-right",
														"middle-left",
														"middle-right",
														"bottom-left",
														"bottom-center",
														"bottom-right",
													]
												: []
									}
									keepRatio={selectionAnnotation?.kind === "text"}
									flipEnabled={false}
									shouldOverdrawWholeArea
									borderStroke="#34b27b"
									borderStrokeWidth={1.5 / scale}
									borderDash={[5 / scale, 4 / scale]}
									padding={5 / scale}
									anchorSize={10 / scale}
									anchorCornerRadius={2 / scale}
									anchorFill="#ffffff"
									anchorStroke="#34b27b"
									anchorStrokeWidth={2 / scale}
									rotateAnchorOffset={28 / scale}
									boundBoxFunc={(oldBox, nextBox) =>
										Math.abs(nextBox.width) < 8 / scale || Math.abs(nextBox.height) < 8 / scale
											? oldBox
											: nextBox
									}
									onPointerDown={(event) => {
										event.cancelBubble = true;
									}}
									onDblClick={() => {
										if (selected?.kind === "text") beginInlineTextEdit(selected.id);
									}}
									onDblTap={() => {
										if (selected?.kind === "text") beginInlineTextEdit(selected.id);
									}}
									onTransformEnd={endStandardTransform}
								/>
								{selectionHandles && (
									<>
										<Line
											listening={false}
											points={[
												selectionHandles.start.x,
												selectionHandles.start.y,
												selectionHandles.end.x,
												selectionHandles.end.y,
											]}
											stroke="#34b27b"
											strokeWidth={1 / scale}
											dash={[4 / scale, 4 / scale]}
											opacity={0.7}
										/>
										{(["start", "end"] as const).map((handle) => (
											<Circle
												key={handle}
												name={ANNOTATION_HANDLE_NAME}
												x={selectionHandles[handle].x}
												y={selectionHandles[handle].y}
												radius={8 / scale}
												fill="#ffffff"
												stroke="#34b27b"
												strokeWidth={2 / scale}
												hitStrokeWidth={16 / scale}
												draggable
												onDragStart={() => {
													if (selectionAnnotation) beginHandleDrag(selectionAnnotation);
												}}
												onDragMove={(event) =>
													dragHandle(handle, event.target.x(), event.target.y())
												}
												onDragEnd={(event) =>
													endHandleDrag(handle, event.target.x(), event.target.y())
												}
											/>
										))}
									</>
								)}
								{crop && (
									<Group listening={false}>
										<Rect
											x={0}
											y={0}
											width={current.width}
											height={crop.y}
											fill="rgba(0,0,0,0.55)"
										/>
										<Rect
											x={0}
											y={crop.y + crop.height}
											width={current.width}
											height={current.height - crop.y - crop.height}
											fill="rgba(0,0,0,0.55)"
										/>
										<Rect
											x={0}
											y={crop.y}
											width={crop.x}
											height={crop.height}
											fill="rgba(0,0,0,0.55)"
										/>
										<Rect
											x={crop.x + crop.width}
											y={crop.y}
											width={current.width - crop.x - crop.width}
											height={crop.height}
											fill="rgba(0,0,0,0.55)"
										/>
										<Rect
											{...crop}
											stroke="#ffffff"
											strokeWidth={1.5 / scale}
											dash={[6 / scale, 4 / scale]}
										/>
									</Group>
								)}
							</Layer>
						</Stage>
					</div>
					{editingTextAnnotation && (
						<textarea
							ref={inlineTextRef}
							data-testid="screenshot-inline-text-editor"
							className={styles.inlineTextEditor}
							aria-label={t("editor.editText")}
							value={inlineText}
							maxLength={2000}
							wrap="off"
							spellCheck
							style={{
								left: editingTextAnnotation.x * scale,
								top: editingTextAnnotation.y * scale,
								width: Math.min(
									Math.max(
										120,
										measureTextSpan({ ...editingTextAnnotation, text: inlineText }) * scale + 24,
									),
									Math.max(120, (current.width - editingTextAnnotation.x) * scale),
								),
								height:
									Math.max(1, inlineText.split("\n").length) *
										editingTextAnnotation.fontSize *
										scale *
										1.2 +
									12,
								color: editingTextAnnotation.color,
								backgroundColor: textEditorBackground(editingTextAnnotation.color),
								fontFamily: TEXT_FONT_FAMILY,
								fontSize: editingTextAnnotation.fontSize * scale,
								lineHeight: 1.2,
								transform: `rotate(${editingTextAnnotation.rotation}deg)`,
							}}
							onChange={(event) => setInlineText(event.target.value)}
							onBlur={() => finishInlineTextEdit(true)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									finishInlineTextEdit(false);
								} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
									event.preventDefault();
									finishInlineTextEdit(true);
								}
							}}
						/>
					)}
					{ocrVisible && ocrBlocks.length > 0 && (
						<OcrTextOverlay
							blocks={ocrBlocks}
							renderedHeight={current.height * scale}
							label={t("editor.ocr.overlayLabel")}
						/>
					)}
				</div>
			</div>
			<footer className={styles.statusbar}>
				<span>{t("editor.zoom", { percent: Math.round(scale * 100) })}</span>
				<span role={error ? "alert" : "status"} className={error ? styles.error : styles.success}>
					{error || message}
				</span>
				<span>{t("editor.shortcuts")}</span>
			</footer>
			<Dialog open={showDiscard} onOpenChange={handleDiscardOpenChange}>
				<DialogContent className="border-white/10 bg-[#141619] text-white">
					<DialogTitle>{t("editor.discardTitle")}</DialogTitle>
					<DialogDescription>{t("editor.discardDescription")}</DialogDescription>
					<DialogFooter>
						<button
							type="button"
							className={styles.button}
							onClick={() => {
								handleDiscardOpenChange(false);
							}}
						>
							{t("editor.keepEditing")}
						</button>
						<button
							type="button"
							className={`${styles.button} ${styles.danger}`}
							onClick={() => {
								if (leaveIntent === "back") onBack();
								else {
									allowCloseRef.current = true;
									window.close();
								}
							}}
						>
							{t("editor.discard")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
