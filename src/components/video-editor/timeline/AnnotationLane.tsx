import { useRow } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { type AnnotationTrackKind, annotationLaneRowId } from "./annotationTracks";

/** Height of one lane; a row grows by one of these for every lane it has. */
export const ANNOTATION_LANE_HEIGHT = 36;

interface AnnotationLaneProps {
	kind: AnnotationTrackKind;
	lane: number;
	/** The extra lane offered while dragging, which becomes a real lane once dropped into. */
	isNewLane?: boolean;
	newLaneHint?: string;
	children?: React.ReactNode;
}

/** One lane of an annotation row, registered as its own drop target. */
export default function AnnotationLane({
	kind,
	lane,
	isNewLane = false,
	newLaneHint,
	children,
}: AnnotationLaneProps) {
	const { setNodeRef, rowStyle, isOver } = useRow({ id: annotationLaneRowId(kind, lane) });

	return (
		<div
			data-annotation-lane={kind}
			data-lane-index={lane}
			data-new-lane={isNewLane || undefined}
			className={cn(
				"transition-colors",
				lane > 0 && !isNewLane && "border-t border-white/[0.04]",
				isNewLane && "border-t border-dashed border-white/15",
				isOver && "bg-[#B4A046]/10",
			)}
			style={{ display: "flex", height: ANNOTATION_LANE_HEIGHT }}
		>
			{/* Items are absolutely positioned; this node must be their containing block
			    or every lane's items collapse onto the row's first lane. Kept inline
			    because it is structural, not styling. */}
			<div ref={setNodeRef} style={{ ...rowStyle, position: "relative", height: "100%" }}>
				{isNewLane && newLaneHint && (
					<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
						<span className="text-[11px] font-medium text-white/30">{newLaneHint}</span>
					</div>
				)}
				{children}
			</div>
		</div>
	);
}
