import { useEffect, useLayoutEffect, useRef } from "react";
import type { DraggableData, Rnd, RndDragEvent } from "react-rnd";
import {
	type CanvasDragSnap,
	type CanvasRect,
	getRotatedCanvasRect,
	snapCanvasRect,
} from "@/lib/canvasSnapping";

function pointerPoint(event: RndDragEvent) {
	if ("touches" in event) return event.touches[0] ?? event.changedTouches[0] ?? null;
	return event;
}

/** Keep raw pointer motion separate from the snapped position so dragging cannot stick. */
export function useSnappedCanvasDrag({
	rect,
	width,
	height,
	rotation = 0,
	onPreview,
	onCommit,
	onSnap,
	onSnapEnd,
}: {
	rect: CanvasRect;
	width: number;
	height: number;
	rotation?: number;
	onPreview: (position: { x: number; y: number }) => void;
	onCommit: (position: { x: number; y: number }) => void;
	onSnap?: CanvasDragSnap;
	onSnapEnd?: () => void;
}) {
	const rndRef = useRef<Rnd>(null);
	const startRef = useRef<{
		clientX: number;
		clientY: number;
		x: number;
		y: number;
		scaleX: number;
		scaleY: number;
	} | null>(null);

	// react-draggable's own move update runs after onDrag. Apply the snapped
	// preview after that render, including repeated moves along the same guide.
	useLayoutEffect(() => {
		if (startRef.current) rndRef.current?.updatePosition({ x: rect.x, y: rect.y });
	});
	useEffect(() => () => onSnapEnd?.(), [onSnapEnd]);

	const start = (event: RndDragEvent, _data: DraggableData) => {
		const point = pointerPoint(event);
		if (!point) return;
		const parentRect = rndRef.current?.getSelfElement()?.parentElement?.getBoundingClientRect();
		startRef.current = {
			clientX: point.clientX,
			clientY: point.clientY,
			x: rect.x,
			y: rect.y,
			scaleX: parentRect?.width ? width / parentRect.width : 1,
			scaleY: parentRect?.height ? height / parentRect.height : 1,
		};
	};
	const resolve = (event: RndDragEvent, data: DraggableData) => {
		const point = pointerPoint(event);
		const origin = startRef.current;
		const rawX =
			origin && point ? origin.x + (point.clientX - origin.clientX) * origin.scaleX : data.x;
		const rawY =
			origin && point ? origin.y + (point.clientY - origin.clientY) * origin.scaleY : data.y;
		const raw = {
			...rect,
			x: Math.max(0, Math.min(Math.max(0, width - rect.width), rawX)),
			y: Math.max(0, Math.min(Math.max(0, height - rect.height), rawY)),
		};
		const visual = getRotatedCanvasRect(raw, rotation);
		const bounds = {
			minX: visual.x - raw.x,
			maxX: Math.max(0, width - rect.width) + visual.x - raw.x,
			minY: visual.y - raw.y,
			maxY: Math.max(0, height - rect.height) + visual.y - raw.y,
		};
		const snapped = onSnap
			? onSnap(visual, event.altKey, bounds)
			: snapCanvasRect({
					rect: visual,
					frame: { x: 0, y: 0, width, height },
					bounds,
					disabled: event.altKey,
				});
		return { x: raw.x + snapped.x - visual.x, y: raw.y + snapped.y - visual.y };
	};
	const move = (event: RndDragEvent, data: DraggableData) => onPreview(resolve(event, data));
	const stop = (event: RndDragEvent, data: DraggableData) => {
		const position = resolve(event, data);
		startRef.current = null;
		onPreview(position);
		onCommit(position);
		onSnapEnd?.();
	};
	return { rndRef, start, move, stop };
}
