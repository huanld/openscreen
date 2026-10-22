import { CANVAS_SNAP_COLOR, type CanvasSnapGuide } from "@/lib/canvasSnapping";

export function CanvasSnapGuides({
	guides,
	width,
	height,
}: {
	guides: readonly CanvasSnapGuide[];
	width: number;
	height: number;
}) {
	if (!guides.length) return null;
	return (
		<svg
			aria-hidden="true"
			data-testid="canvas-snap-guides"
			className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			viewBox={`0 0 ${width} ${height}`}
			style={{ zIndex: 200_000 }}
		>
			{guides.map((guide) => (
				<line
					key={guide.axis}
					data-snap-axis={guide.axis}
					x1={guide.axis === "x" ? guide.position : guide.start}
					y1={guide.axis === "y" ? guide.position : guide.start}
					x2={guide.axis === "x" ? guide.position : guide.end}
					y2={guide.axis === "y" ? guide.position : guide.end}
					stroke={CANVAS_SNAP_COLOR}
					strokeWidth={1}
					strokeDasharray="4 3"
					vectorEffect="non-scaling-stroke"
				/>
			))}
		</svg>
	);
}
