/* eslint-disable lasertag/export-own-component-only, lasertag/render-tag-with-own-name -- Shared Konva scene components intentionally return renderer nodes. */
import {
	Circle,
	Group,
	type KonvaEventObject,
	Line,
	Path,
	Rect,
} from "@create-art/preact-konva"

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
	readonly dashOffset?: number
	readonly lineCap?: "butt" | "round" | "square"
	readonly lineJoin?: "miter" | "round" | "bevel"
	readonly miterLimit?: number
	readonly listening?: boolean
	readonly selected?: boolean
	readonly onPointerDown?: (event: KonvaEventObject<PointerEvent>) => void
	readonly onDoubleClick?: (
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	) => void
	readonly onPointerEnter?: (event: KonvaEventObject<PointerEvent>) => void
	readonly onPointerLeave?: (event: KonvaEventObject<PointerEvent>) => void
}) {
	const { onDoubleClick, ...pathProps } = props
	return (
		<Path
			{...pathProps}
			name={`vector-contour-path ${name}`}
			data={vectorObjectPath(object)}
			{...(selected && pathProps.stroke === undefined
				? { stroke: "#e17352" }
				: {})}
			onDblClick={(event) => onDoubleClick?.(event)}
			onDblTap={(event) => onDoubleClick?.(event)}
		/>
	)
}

export function VectorControlHandles({
	node,
	inverseScale,
	color,
	selected = false,
	selectedHandles = [],
	listening = false,
	draggable = false,
	nodeShape = "circle",
	endpointNormal,
	fill = "#fff",
	stroke = color,
	handleColor = color,
	handleOpacity = {},
	nodeHitRadius,
	handleHitRadius,
	onNodePointerDown,
	onNodeDoubleClick,
	onNodeDragStart,
	onNodeDragMove,
	onNodeDragEnd,
	onHandlePointerDown,
	onHandleDoubleClick,
	onHandleDragStart,
	onHandleDragMove,
	onHandleDragEnd,
}: {
	readonly node: VectorNode
	readonly inverseScale: number
	readonly color: string
	readonly selected?: boolean
	readonly selectedHandles?: readonly ("incoming" | "outgoing")[]
	readonly listening?: boolean
	readonly draggable?: boolean
	readonly nodeShape?: "circle" | "square" | "endpoint"
	readonly endpointNormal?: VectorPoint
	readonly fill?: string
	readonly stroke?: string
	readonly handleColor?: string
	readonly handleOpacity?: Readonly<
		Partial<Record<"incoming" | "outgoing", number>>
	>
	readonly nodeHitRadius?: number
	readonly handleHitRadius?: Readonly<
		Partial<Record<"incoming" | "outgoing", number>>
	>
	readonly onNodePointerDown?: (event: KonvaEventObject<PointerEvent>) => void
	readonly onNodeDoubleClick?: (
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	) => void
	readonly onNodeDragStart?: (event: KonvaEventObject<DragEvent>) => void
	readonly onNodeDragMove?: (event: KonvaEventObject<DragEvent>) => void
	readonly onNodeDragEnd?: (event: KonvaEventObject<DragEvent>) => void
	readonly onHandlePointerDown?: (
		handle: "incoming" | "outgoing",
		event: KonvaEventObject<PointerEvent>,
	) => void
	readonly onHandleDoubleClick?: (
		handle: "incoming" | "outgoing",
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	) => void
	readonly onHandleDragStart?: (
		handle: "incoming" | "outgoing",
		event: KonvaEventObject<DragEvent>,
	) => void
	readonly onHandleDragMove?: (
		handle: "incoming" | "outgoing",
		event: KonvaEventObject<DragEvent>,
	) => void
	readonly onHandleDragEnd?: (
		handle: "incoming" | "outgoing",
		event: KonvaEventObject<DragEvent>,
	) => void
}) {
	const nodeProps = {
		id: node.id,
		name: "vector-node outline-point",
		x: node.x,
		y: node.y,
		fill,
		stroke,
		strokeWidth: (selected ? 2 : 1.5) * inverseScale,
		draggable,
		onPointerDown: (event: KonvaEventObject<PointerEvent>) =>
			onNodePointerDown?.(event),
		onDblClick: (event: KonvaEventObject<MouseEvent>) =>
			onNodeDoubleClick?.(event),
		onDblTap: (event: KonvaEventObject<MouseEvent | TouchEvent>) =>
			onNodeDoubleClick?.(event),
		onDragStart: (event: KonvaEventObject<DragEvent>) =>
			onNodeDragStart?.(event),
		onDragMove: (event: KonvaEventObject<DragEvent>) => onNodeDragMove?.(event),
		onDragEnd: (event: KonvaEventObject<DragEvent>) => onNodeDragEnd?.(event),
	}
	return (
		<Group name="vector-controls" listening={listening}>
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
							opacity={handleOpacity[handle] ?? 1}
							listening={false}
						/>
						{handleHitRadius?.[handle] === undefined ? null : (
							<Circle
								name="outline-control-helper"
								x={endpoint.x}
								y={endpoint.y}
								radius={handleHitRadius[handle]}
								fill="rgb(0 0 0 / 0.001)"
							/>
						)}
						<Circle
							name={`vector-handle vector-handle-${handle} bezier-handle`}
							x={endpoint.x}
							y={endpoint.y}
							radius={3.5 * inverseScale}
							fill={handleColor}
							stroke={stroke}
							strokeWidth={inverseScale}
							opacity={handleOpacity[handle] ?? 1}
							draggable={draggable}
							onPointerDown={(event) => onHandlePointerDown?.(handle, event)}
							onDblClick={(event) => onHandleDoubleClick?.(handle, event)}
							onDblTap={(event) => onHandleDoubleClick?.(handle, event)}
							onDragStart={(event) => onHandleDragStart?.(handle, event)}
							onDragMove={(event) => onHandleDragMove?.(handle, event)}
							onDragEnd={(event) => onHandleDragEnd?.(handle, event)}
						/>
						{selectedHandles.includes(handle) ? (
							<Circle
								name={`vector-handle-selection vector-handle-selection-${handle}`}
								x={endpoint.x}
								y={endpoint.y}
								radius={8 * inverseScale}
								stroke={color}
								strokeWidth={2 * inverseScale}
								listening={false}
							/>
						) : null}
					</Group>
				)
			})}
			{selected ? (
				<Circle
					name="vector-node-selection"
					x={node.x}
					y={node.y}
					radius={10 * inverseScale}
					stroke={color}
					strokeWidth={2 * inverseScale}
					listening={false}
				/>
			) : null}
			{nodeHitRadius === undefined ? null : (
				<Circle
					name="outline-control-helper"
					x={node.x}
					y={node.y}
					radius={nodeHitRadius}
					fill="rgb(0 0 0 / 0.001)"
				/>
			)}
			{nodeShape === "endpoint" && endpointNormal !== undefined ? (
				<Line
					{...nodeProps}
					points={[
						-endpointNormal.x * 6 * inverseScale,
						-endpointNormal.y * 6 * inverseScale,
						endpointNormal.x * 6 * inverseScale,
						endpointNormal.y * 6 * inverseScale,
					]}
					strokeWidth={2 * inverseScale}
					lineCap="round"
				/>
			) : nodeShape === "square" ? (
				<Rect
					{...nodeProps}
					width={9 * inverseScale}
					height={9 * inverseScale}
					offsetX={4.5 * inverseScale}
					offsetY={4.5 * inverseScale}
				/>
			) : (
				<Circle {...nodeProps} radius={5 * inverseScale} />
			)}
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
			<VectorControlHandles
				node={node}
				inverseScale={inverseScale}
				color={color}
			/>
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
	yAxis = "down",
	draggable = false,
	onHandlePointerDown,
	onHandleDragStart,
	onHandleDragMove,
	onHandleDragEnd,
	onHandlePointerEnter,
	onHandlePointerLeave,
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
	readonly yAxis?: "up" | "down"
	readonly draggable?: boolean
	readonly onHandlePointerDown?: (
		handle: VectorTransformHandle,
		event: KonvaEventObject<PointerEvent>,
	) => void
	readonly onHandleDragStart?: (
		handle: VectorTransformHandle,
		event: KonvaEventObject<DragEvent>,
	) => void
	readonly onHandleDragMove?: (
		handle: VectorTransformHandle,
		event: KonvaEventObject<DragEvent>,
	) => void
	readonly onHandleDragEnd?: (
		handle: VectorTransformHandle,
		event: KonvaEventObject<DragEvent>,
	) => void
	readonly onHandlePointerEnter?: (handle: VectorTransformHandle) => void
	readonly onHandlePointerLeave?: (handle: VectorTransformHandle) => void
}) {
	const orientedBounds =
		yAxis === "down"
			? bounds
			: {
					minX: bounds.minX,
					maxX: bounds.maxX,
					minY: bounds.maxY,
					maxY: bounds.minY,
				}
	const rotationPoint = {
		x: (bounds.minX + bounds.maxX) / 2,
		y:
			yAxis === "down"
				? bounds.minY - 28 * inverseScale
				: bounds.maxY + 28 * inverseScale,
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
				draggable={draggable}
				onPointerDown={(event) => onHandlePointerDown?.("move", event)}
				onDragStart={(event) => onHandleDragStart?.("move", event)}
				onDragMove={(event) => onHandleDragMove?.("move", event)}
				onDragEnd={(event) => onHandleDragEnd?.("move", event)}
				onMouseEnter={() => onHandlePointerEnter?.("move")}
				onMouseLeave={() => onHandlePointerLeave?.("move")}
			/>
			{handles.map((handle) => {
				const point = handlePoint(orientedBounds, handle)
				return (
					<Rect
						key={handle}
						name={`transform-handle transform-handle-${handle}`}
						x={point.x}
						y={point.y}
						width={10 * inverseScale}
						height={10 * inverseScale}
						offsetX={5 * inverseScale}
						offsetY={5 * inverseScale}
						fill="#fff"
						stroke={color}
						strokeWidth={1.5 * inverseScale}
						draggable={draggable}
						onPointerDown={(event) => onHandlePointerDown?.(handle, event)}
						onDragStart={(event) => onHandleDragStart?.(handle, event)}
						onDragMove={(event) => onHandleDragMove?.(handle, event)}
						onDragEnd={(event) => onHandleDragEnd?.(handle, event)}
						onMouseEnter={() => onHandlePointerEnter?.(handle)}
						onMouseLeave={() => onHandlePointerLeave?.(handle)}
					/>
				)
			})}
			{rotation ? (
				<>
					<Line
						name="transform-rotation-stem"
						points={[
							(bounds.minX + bounds.maxX) / 2,
							yAxis === "down" ? bounds.minY : bounds.maxY,
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
						draggable={draggable}
						onPointerDown={(event) => onHandlePointerDown?.("rotation", event)}
						onDragStart={(event) => onHandleDragStart?.("rotation", event)}
						onDragMove={(event) => onHandleDragMove?.("rotation", event)}
						onDragEnd={(event) => onHandleDragEnd?.("rotation", event)}
						onMouseEnter={() => onHandlePointerEnter?.("rotation")}
						onMouseLeave={() => onHandlePointerLeave?.("rotation")}
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
