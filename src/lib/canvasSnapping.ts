export interface CanvasRect {
	id?: string;
	ownerId?: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasSnapBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export interface CanvasSnapGuide {
	axis: "x" | "y";
	position: number;
	start: number;
	end: number;
}

export type CanvasDragSnap = (
	rect: CanvasRect,
	bypass: boolean,
	bounds?: CanvasSnapBounds,
) => { x: number; y: number };

export const CANVAS_SNAP_DISTANCE = 6;
export const CANVAS_SNAP_COLOR = "#ec4899";

/** Visual bounds of a box rotated around its center, as in the video editor. */
export function getRotatedCanvasRect(rect: CanvasRect, rotation = 0): CanvasRect {
	const radians = (rotation * Math.PI) / 180;
	const width =
		Math.abs(rect.width * Math.cos(radians)) + Math.abs(rect.height * Math.sin(radians));
	const height =
		Math.abs(rect.width * Math.sin(radians)) + Math.abs(rect.height * Math.cos(radians));
	return {
		...rect,
		x: rect.x + (rect.width - width) / 2,
		y: rect.y + (rect.height - height) / 2,
		width,
		height,
	};
}

function isUsableRect(rect: CanvasRect) {
	return (
		[rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
		rect.width > 0 &&
		rect.height > 0
	);
}

/** All coordinates and the threshold use the caller's canvas coordinate space. */
export function snapCanvasRect({
	rect,
	frame,
	targets = [],
	threshold = CANVAS_SNAP_DISTANCE,
	disabled = false,
	bounds,
}: {
	rect: CanvasRect;
	frame: CanvasRect;
	targets?: readonly CanvasRect[];
	threshold?: number;
	disabled?: boolean;
	bounds?: CanvasSnapBounds;
}): { x: number; y: number; guides: CanvasSnapGuide[] } {
	if (
		disabled ||
		!isUsableRect(rect) ||
		!isUsableRect(frame) ||
		!Number.isFinite(threshold) ||
		threshold < 0
	) {
		return { x: rect.x, y: rect.y, guides: [] };
	}
	const candidates = [
		frame,
		...targets.filter(
			(target) =>
				(!rect.id || (target.id !== rect.id && target.ownerId !== rect.id)) && isUsableRect(target),
		),
	];
	const matches: Partial<
		Record<"x" | "y", { delta: number; target: CanvasRect; position: number; priority: number }>
	> = {};
	for (const axis of ["x", "y"] as const) {
		const size = axis === "x" ? "width" : "height";
		const minimum = axis === "x" ? bounds?.minX : bounds?.minY;
		const maximum = axis === "x" ? bounds?.maxX : bounds?.maxY;
		for (const target of candidates) {
			for (const sourceAnchor of [0, 0.5, 1]) {
				for (const targetAnchor of [0, 0.5, 1]) {
					const position = target[axis] + target[size] * targetAnchor;
					const delta = position - (rect[axis] + rect[size] * sourceAnchor);
					const next = rect[axis] + delta;
					if (
						Math.abs(delta) > threshold ||
						(minimum !== undefined && next < minimum - 1e-6) ||
						(maximum !== undefined && next > maximum + 1e-6)
					)
						continue;
					const priority = sourceAnchor === targetAnchor ? (sourceAnchor === 0.5 ? 0 : 1) : 2;
					const match = matches[axis];
					if (
						!match ||
						Math.abs(delta) < Math.abs(match.delta) - 1e-6 ||
						(Math.abs(Math.abs(delta) - Math.abs(match.delta)) < 1e-6 && priority < match.priority)
					) {
						matches[axis] = { delta, target, position, priority };
					}
				}
			}
		}
	}
	const snapped = { x: rect.x + (matches.x?.delta ?? 0), y: rect.y + (matches.y?.delta ?? 0) };
	const guides: CanvasSnapGuide[] = [];
	for (const axis of ["x", "y"] as const) {
		const match = matches[axis];
		if (!match) continue;
		const across = axis === "x" ? "y" : "x";
		const size = axis === "x" ? "height" : "width";
		guides.push({
			axis,
			position: match.position,
			start: Math.min(snapped[across], match.target[across]),
			end: Math.max(snapped[across] + rect[size], match.target[across] + match.target[size]),
		});
	}
	return { ...snapped, guides };
}
