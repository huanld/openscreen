import { Check, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { Annotation, AnnotationOrder } from "./editorDocument";
import { normalizeRotation } from "./editorDocument";
import styles from "./ImageEditor.module.css";

export type AnnotationPropertyPatch = Pick<Annotation, "x" | "y" | "rotation"> &
	Partial<Pick<Annotation, "color" | "strokeWidth" | "text" | "fontSize">>;

export type AnnotationReorderDirection = AnnotationOrder;

export interface ImageAnnotationInspectorProps {
	annotation: Annotation;
	canEdit: boolean;
	index: number;
	count: number;
	onApply: (patch: AnnotationPropertyPatch) => void;
	onDuplicate: () => void;
	onReorder: (direction: AnnotationReorderDirection) => void;
}

interface PropertyDraft {
	x: string;
	y: string;
	rotation: string;
	color: string;
	strokeWidth: string;
	text: string;
	fontSize: string;
}

function draftFromAnnotation(annotation: Annotation): PropertyDraft {
	return {
		x: String(annotation.x),
		y: String(annotation.y),
		rotation: String(annotation.rotation),
		color: annotation.color,
		strokeWidth: String(annotation.strokeWidth),
		text: annotation.text,
		fontSize: String(annotation.fontSize),
	};
}

function finiteNumber(value: string, fallback: number): number {
	if (!value.trim()) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function validColor(value: string, fallback: string): string {
	return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export default function ImageAnnotationInspector({
	annotation,
	canEdit,
	index,
	count,
	onApply,
	onDuplicate,
	onReorder,
}: ImageAnnotationInspectorProps) {
	const t = useScopedT("screenshot");
	const [draft, setDraft] = useState<PropertyDraft>(() => draftFromAnnotation(annotation));

	useEffect(() => {
		setDraft(draftFromAnnotation(annotation));
	}, [annotation]);

	const isStroke =
		annotation.kind === "pen" || annotation.kind === "arrow" || annotation.kind === "rectangle";
	const isText = annotation.kind === "text";
	const textIsValid = !isText || draft.text.trim().length > 0;
	const isAtBack = index <= 0;
	const isAtFront = index >= count - 1;

	function applyProperties() {
		if (!canEdit || !textIsValid) return;
		const patch: AnnotationPropertyPatch = {
			x: finiteNumber(draft.x, annotation.x),
			y: finiteNumber(draft.y, annotation.y),
			rotation: normalizeRotation(finiteNumber(draft.rotation, annotation.rotation)),
		};
		if (annotation.kind !== "redact") {
			patch.color = validColor(draft.color, annotation.color);
		}
		if (isStroke) {
			patch.strokeWidth = clamp(finiteNumber(draft.strokeWidth, annotation.strokeWidth), 1, 32);
		}
		if (isText) {
			patch.text = draft.text.replace(/\r\n/g, "\n");
			patch.fontSize = clamp(finiteNumber(draft.fontSize, annotation.fontSize), 6, 240);
		}
		onApply(patch);
	}

	return (
		<section
			data-testid="screenshot-annotation-inspector"
			className={styles.inspector}
			aria-label={t("editor.selectedItem")}
		>
			<strong>
				{t("editor.selectedItem")} {index + 1}/{count}
			</strong>
			<label className={styles.option}>
				{t("editor.xPosition")}
				<input
					data-testid="screenshot-annotation-x"
					type="number"
					value={draft.x}
					disabled={!canEdit}
					onChange={(event) => setDraft((current) => ({ ...current, x: event.target.value }))}
				/>
			</label>
			<label className={styles.option}>
				{t("editor.yPosition")}
				<input
					data-testid="screenshot-annotation-y"
					type="number"
					value={draft.y}
					disabled={!canEdit}
					onChange={(event) => setDraft((current) => ({ ...current, y: event.target.value }))}
				/>
			</label>
			<label className={styles.option}>
				{t("editor.rotation")}
				<input
					data-testid="screenshot-annotation-rotation"
					type="number"
					value={draft.rotation}
					disabled={!canEdit}
					onChange={(event) =>
						setDraft((current) => ({ ...current, rotation: event.target.value }))
					}
				/>
			</label>
			{annotation.kind !== "redact" && (
				<label className={styles.option}>
					{t("editor.color")}
					<input
						data-testid="screenshot-annotation-color"
						type="color"
						value={draft.color}
						disabled={!canEdit}
						onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
					/>
				</label>
			)}
			{isStroke && (
				<label className={styles.option}>
					{t("editor.stroke")}
					<input
						data-testid="screenshot-annotation-stroke"
						type="number"
						min={1}
						max={32}
						value={draft.strokeWidth}
						disabled={!canEdit}
						onChange={(event) =>
							setDraft((current) => ({ ...current, strokeWidth: event.target.value }))
						}
					/>
				</label>
			)}
			{isText && (
				<>
					<textarea
						data-testid="screenshot-annotation-text"
						className={styles.textInput}
						aria-label={t("editor.editText")}
						value={draft.text}
						rows={2}
						maxLength={2000}
						disabled={!canEdit}
						onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
					/>
					<label className={styles.option}>
						{t("editor.fontSize")}
						<input
							data-testid="screenshot-annotation-font-size"
							type="number"
							min={6}
							max={240}
							value={draft.fontSize}
							disabled={!canEdit}
							onChange={(event) =>
								setDraft((current) => ({ ...current, fontSize: event.target.value }))
							}
						/>
					</label>
				</>
			)}
			<button
				type="button"
				data-testid="screenshot-annotation-apply"
				className={styles.button}
				disabled={!canEdit || !textIsValid}
				onClick={applyProperties}
			>
				<Check size={16} />
				{t("editor.applyProperties")}
			</button>
			<button
				type="button"
				data-testid="screenshot-annotation-duplicate"
				className={styles.button}
				disabled={!canEdit}
				onClick={onDuplicate}
			>
				<Copy size={16} />
				{t("editor.duplicate")}
			</button>
			<div className={styles.historyActions}>
				<button
					type="button"
					data-testid="screenshot-annotation-send-to-back"
					className={styles.iconButton}
					title={t("editor.sendToBack")}
					aria-label={t("editor.sendToBack")}
					disabled={!canEdit || isAtBack}
					onClick={() => onReorder("back")}
				>
					<ChevronsDown size={18} />
				</button>
				<button
					type="button"
					data-testid="screenshot-annotation-send-backward"
					className={styles.iconButton}
					title={t("editor.sendBackward")}
					aria-label={t("editor.sendBackward")}
					disabled={!canEdit || isAtBack}
					onClick={() => onReorder("backward")}
				>
					<ChevronDown size={18} />
				</button>
				<button
					type="button"
					data-testid="screenshot-annotation-bring-forward"
					className={styles.iconButton}
					title={t("editor.bringForward")}
					aria-label={t("editor.bringForward")}
					disabled={!canEdit || isAtFront}
					onClick={() => onReorder("forward")}
				>
					<ChevronUp size={18} />
				</button>
				<button
					type="button"
					data-testid="screenshot-annotation-bring-to-front"
					className={styles.iconButton}
					title={t("editor.bringToFront")}
					aria-label={t("editor.bringToFront")}
					disabled={!canEdit || isAtFront}
					onClick={() => onReorder("front")}
				>
					<ChevronsUp size={18} />
				</button>
			</div>
		</section>
	);
}
