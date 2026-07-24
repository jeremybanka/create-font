/* eslint-disable lasertag/export-own-component-only, lasertag/render-tag-with-own-name -- Shared Konva scene components intentionally return renderer nodes. */
import {
	Circle,
	Group,
	type KonvaEventObject,
	Line,
	Path,
	Rect,
} from "@create-font/preact-konva"

import type {
	VectorGesturePreview,
	VectorSnapGuide,
	VectorTransformHandle,
} from "./vector-gesture.ts"
import {
	vectorObjectPath,
	vectorShapeNodes,
	type VectorBounds,
} from "./vector-scene.ts"
import type { VectorNode, VectorObject, VectorPoint } from "./vector-editing.ts"

export function VectorContourPath({
	object,
	name,
	selected = false,
	...props
}: {
	readonly object: VectorObject
	readonly name: string
	readonly fill?: string
	readonly stroke?: string
	readonly fillEnabled?: boolean
	readonly fillRule?: "evenodd" | "nonzero"
	readonly opacity?: number
	readonly strokeWidth?: number
	readonly dash?: number[]
	readonly listening?: boolean
	readonly selected?: boolean
	readonly onPointerDown?: (event: KonvaEventObject<PointerEvent>) => void
	readonly onPointerEnter?: (event: KonvaEventObject<PointerEvent>) => void
	readonly onPointerLeave?: (event: KonvaEventObject<PointerEvent>) => void
}) {
	return (
		<Path
			{...props}
			name={`vector-contour-path ${name}`}
			data={vectorObjectPath(object)}
			{...(selected && props.stroke === undefined ? { stroke: "#e17352" } : {})}
		/>
	)
}

export function VectorControlHandles({
	node,
	inverseScale,
	color,
	selected = false,
}: {
	readonly node: VectorNode
	readonly inverseScale: number
	readonly color: string
	readonly selected?: boolean
}) {
	return (
		<Group name="vector-controls" listening={false}>
			{(["incoming", "outgoing"] as const).map((handle) => {
				const vector = node[handle]
				if (vector === undefined) return null
				const endpoint = { x: node.x + vector.x, y: node.y + vector.y }
				return (
					<Group key={handle}>
						<Line
							name={`vector-handle-line vector-handle-${handle}`}
							points={[node.x, node.y, endpoint.x, endpoint.y]}
							stroke={color}
							strokeWidth={inverseScale}
						/>
						<Circle
							name={`vector-handle vector-handle-${handle}`}
							x={endpoint.x}
							y={endpoint.y}
							radius={3.5 * inverseScale}
							fill={color}
							stroke="#fff"
							strokeWidth={inverseScale}
						/>
					</Group>
				)
			})}
			<Circle
				name="vector-node"
				x={node.x}
				y={node.y}
				radius={(selected ? 6 : 4) * inverseScale}
				fill="#fff"
				stroke={color}
				strokeWidth={(selected ? 2 : 1.5) * inverseScale}
			/>
		</Group>
	)
}

export function VectorPenPreview({
	preview,
	preceding = [],
	inverseScale,
	color,
}: {
	readonly preview: Extract<VectorGesturePreview, { readonly kind: "pen" }>
	readonly preceding?: readonly (VectorPoint &
		Partial<Pick<VectorNode, "incoming" | "outgoing" | "mode">>)[]
	readonly inverseScale: number
	readonly color: string
}) {
	const node: VectorNode = {
		id: "pen-preview",
		x: preview.point.x,
		y: preview.point.y,
		mode: preview.mode,
		...(preview.handles?.incoming === undefined
			? {}
			: { incoming: preview.handles.incoming }),
		...(preview.handles?.outgoing === undefined
			? {}
			: { outgoing: preview.handles.outgoing }),
	}
	const nodes: readonly VectorNode[] = [
		...preceding.map((point, index) => ({
			id: `pen-preview:${index}`,
			mode:
				point.mode ??
				(point.incoming === undefined && point.outgoing === undefined
					? ("hard" as const)
					: ("soft" as const)),
			x: point.x,
			y: point.y,
			...(point.incoming === undefined ? {} : { incoming: point.incoming }),
			...(point.outgoing === undefined ? {} : { outgoing: point.outgoing }),
		})),
		node,
	]
	return (
		<Group name="vector-pen-preview" listening={false}>
			{preceding.length === 0 ? null : (
				<VectorContourPath
					name="pen-preview-path"
					object={{
						id: "pen-preview",
						name: "Pen preview",
						style: { kind: "neutral" },
						contours: [
							{
								id: "pen-preview:contour",
								closed: false,
								nodes,
							},
						],
					}}
					fillEnabled={false}
					stroke={color}
					strokeWidth={1.5 * inverseScale}
					listening={false}
				/>
			)}
			{nodes.map((candidate) => (
				<VectorControlHandles
					key={candidate.id}
					node={candidate}
					inverseScale={inverseScale}
					color={color}
					selected={candidate === node}
				/>
			))}
		</Group>
	)
}

export function VectorShapePreview({
	preview,
	inverseScale,
	color,
	fill = color,
}: {
	readonly preview: Extract<VectorGesturePreview, { readonly kind: "shape" }>
	readonly inverseScale: number
	readonly color: string
	readonly fill?: string
}) {
	const object: VectorObject = {
		id: "shape-preview",
		name: "Shape preview",
		style: { kind: "neutral" },
		contours: [
			{
				id: "shape-preview:contour",
				closed: true,
				nodes: vectorShapeNodes(preview.shape, preview.bounds),
			},
		],
	}
	return (
		<VectorContourPath
			name="shape-placement-preview"
			object={object}
			fill={fill}
			opacity={0.12}
			stroke={color}
			strokeWidth={1.5 * inverseScale}
			dash={[5 * inverseScale, 4 * inverseScale]}
			listening={false}
		/>
	)
}

const handlePoint = (
	bounds: VectorBounds,
	handle: Exclude<VectorTransformHandle, "move" | "rotation">,
): VectorPoint => ({
	x: handle.includes("w")
		? bounds.minX
		: handle.includes("e")
			? bounds.maxX
			: (bounds.minX + bounds.maxX) / 2,
	y: handle.includes("n")
		? bounds.minY
		: handle.includes("s")
			? bounds.maxY
			: (bounds.minY + bounds.maxY) / 2,
})

export function VectorSelectionBounds({
	bounds,
	inverseScale,
	color,
	handles = ["nw", "ne", "se", "sw"],
	rotation = false,
	listening = true,
	onHandlePointerDown,
}: {
	readonly bounds: VectorBounds
	readonly inverseScale: number
	readonly color: string
	readonly handles?: readonly Exclude<
		VectorTransformHandle,
		"move" | "rotation"
	>[]
	readonly rotation?: boolean
	readonly listening?: boolean
	readonly onHandlePointerDown?: (
		handle: VectorTransformHandle,
		event: KonvaEventObject<PointerEvent>,
	) => void
}) {
	const rotationPoint = {
		x: (bounds.minX + bounds.maxX) / 2,
		y: bounds.minY - 28 * inverseScale,
	}
	return (
		<Group name="vector-selection-bounds" listening={listening}>
			<Rect
				name="transform-selection-box"
				x={bounds.minX}
				y={bounds.minY}
				width={bounds.maxX - bounds.minX}
				height={bounds.maxY - bounds.minY}
				fill={color}
				opacity={0.06}
				stroke={color}
				strokeWidth={1.5 * inverseScale}
				onPointerDown={(event) => onHandlePointerDown?.("move", event)}
			/>
			{handles.map((handle) => {
				const point = handlePoint(bounds, handle)
				return (
					<Rect
						key={handle}
						name={`transform-handle transform-handle-${handle}`}
						x={point.x - 5 * inverseScale}
						y={point.y - 5 * inverseScale}
						width={10 * inverseScale}
						height={10 * inverseScale}
						fill="#fff"
						stroke={color}
						strokeWidth={1.5 * inverseScale}
						onPointerDown={(event) => onHandlePointerDown?.(handle, event)}
					/>
				)
			})}
			{rotation ? (
				<>
					<Line
						name="transform-rotation-stem"
						points={[
							(bounds.minX + bounds.maxX) / 2,
							bounds.minY,
							rotationPoint.x,
							rotationPoint.y,
						]}
						stroke={color}
						strokeWidth={1.5 * inverseScale}
						listening={false}
					/>
					<Circle
						name="transform-rotation"
						x={rotationPoint.x}
						y={rotationPoint.y}
						radius={7 * inverseScale}
						fill="#fff"
						stroke={color}
						strokeWidth={1.5 * inverseScale}
						onPointerDown={(event) => onHandlePointerDown?.("rotation", event)}
					/>
				</>
			) : null}
		</Group>
	)
}

export function VectorSnapGuides({
	guides,
	inverseScale,
	color,
}: {
	readonly guides: readonly VectorSnapGuide[]
	readonly inverseScale: number
	readonly color: string
}) {
	return (
		<Group name="vector-snap-guides" listening={false}>
			{guides.map((guide) => (
				<Line
					key={guide.id}
					name={`active-snap active-snap-${guide.axis}`}
					points={[...guide.points]}
					stroke={color}
					strokeWidth={inverseScale}
					dash={[4 * inverseScale, 3 * inverseScale]}
				/>
			))}
		</Group>
	)
}
