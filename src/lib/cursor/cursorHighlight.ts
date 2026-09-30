export const CURSOR_HIGHLIGHT_COLOR_HEX = 0xfacc15;
export const CURSOR_HIGHLIGHT_FILL = "rgba(250, 204, 21, 0.34)";
export const CURSOR_HIGHLIGHT_BORDER = "rgba(250, 204, 21, 0.92)";
export const CURSOR_HIGHLIGHT_FILL_ALPHA = 0.34;
export const CURSOR_HIGHLIGHT_BORDER_ALPHA = 0.92;

const CURSOR_HIGHLIGHT_DIAMETER_MULTIPLIER = 1.85;
const MIN_CURSOR_HIGHLIGHT_DIAMETER = 48;

export function getCursorHighlightDiameter(cursorHeight: number, sizeScale = 1): number {
	const safeScale = Math.max(0.25, Math.min(2, sizeScale));
	return (
		Math.max(MIN_CURSOR_HIGHLIGHT_DIAMETER, cursorHeight * CURSOR_HIGHLIGHT_DIAMETER_MULTIPLIER) *
		safeScale
	);
}

export function getCursorHighlightBorderWidth(cursorHeight: number): number {
	return Math.max(2, cursorHeight * 0.05);
}

export function drawCursorHighlightOnCanvas(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	cursorHeight: number,
	sizeScale = 1,
): void {
	const diameter = getCursorHighlightDiameter(cursorHeight, sizeScale);

	ctx.save();
	ctx.beginPath();
	ctx.arc(x, y, diameter / 2, 0, Math.PI * 2);
	ctx.fillStyle = CURSOR_HIGHLIGHT_FILL;
	ctx.fill();
	ctx.lineWidth = getCursorHighlightBorderWidth(cursorHeight);
	ctx.strokeStyle = CURSOR_HIGHLIGHT_BORDER;
	ctx.stroke();
	ctx.restore();
}
