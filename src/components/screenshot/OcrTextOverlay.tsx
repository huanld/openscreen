import type { ScreenshotOcrBlock } from "@/native/contracts";
import styles from "./ImageEditor.module.css";

export interface OcrTextOverlayProps {
	blocks: ScreenshotOcrBlock[];
	renderedHeight: number;
	label: string;
}

const OCR_PREVIEW_FONT_HEIGHT_RATIO = 0.9;

/**
 * Selectable DOM text layered over the Konva preview. Keeping OCR out of the
 * canvas makes it easy to copy while ensuring it is never burned into exports.
 */
export default function OcrTextOverlay({ blocks, renderedHeight, label }: OcrTextOverlayProps) {
	const ordered = [...blocks].sort(
		(left, right) => left.box.y - right.box.y || left.box.x - right.box.x,
	);

	return (
		<div
			className={styles.ocrOverlay}
			data-testid="screenshot-ocr-overlay"
			role="region"
			aria-label={label}
		>
			{ordered.map((block) => (
				<span
					key={block.id}
					className={styles.ocrText}
					data-testid="screenshot-ocr-text"
					style={{
						left: `${block.box.x * 100}%`,
						top: `${block.box.y * 100}%`,
						width: `${block.box.width * 100}%`,
						height: `${block.box.height * 100}%`,
						fontSize: `${Math.max(
							8,
							block.box.height * renderedHeight * OCR_PREVIEW_FONT_HEIGHT_RATIO,
						)}px`,
					}}
					title={block.text}
				>
					{block.text}
				</span>
			))}
		</div>
	);
}
