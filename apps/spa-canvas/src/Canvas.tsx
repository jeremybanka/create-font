import {
	onCleanup,
	onMount,
	render,
	useGetter,
	useSetter,
	useTimeline,
	type SpaElement,
	type SpaRoot,
} from "@atom.io/spa"
import { Circle, Group, Layer, Line, Path, Stage } from "@atom.io/spa/konva"
import type Konva from "konva"

import {
	zoomCanvasViewWithOptions,
	type CanvasPoint,
	type CanvasView,
} from "../../../packages/create-art/editor/src/canvas-foundations.ts"
import type {
	VectorHandleKind,
	VectorNode,
} from "../../../packages/create-art/editor/src/vector-editing.ts"
import { vectorObjectPath } from "../../../packages/create-art/editor/src/vector-scene.ts"
import type { CanvasModel, CanvasObject } from "./models.ts"
import { fitCanvas } from "./viewport.ts"

export interface CanvasOptions {
	readonly onSetup?: () => void
	readonly onStage?: (stage: Konva.Stage | null) => void
}

export function mountCanvas(
	host: HTMLElement,
	model: CanvasModel,
	options: CanvasOptions = {},
): SpaRoot {
	return render(() => <Canvas model={model} options={options} />, host, {
		store: model.silo.store,
	})
}

function History(props: { readonly model: CanvasModel }): SpaElement {
	const history = useTimeline(props.model.getTimeline())
	return (
		<div className="history">
			<button
				type="button"
				disabled={history.getCursor() === 0}
				onClick={() => history.undo()}
			>
				Undo
			</button>
			<button
				type="button"
				disabled={history.getCursor() >= history.getLength()}
				onClick={() => history.redo()}
			>
				Redo
			</button>
			<output aria-label="History position">
				{history.getCursor()} / {history.getLength()}
			</output>
		</div>
	)
}

function Canvas(props: {
	readonly model: CanvasModel
	readonly options: CanvasOptions
}): SpaElement {
	const { model } = props
	props.options.onSetup?.()
	const getScene = useGetter(model.scene)
	const getChoice = useGetter(model.choice)
	const getMaster = useGetter(model.master)
	const viewAtom = model.silo.atom<CanvasView>({
		key: "prototype/view",
		default: { x: 0, y: 0, zoom: 1 },
	})
	const sizeAtom = model.silo.atom({
		key: "prototype/size",
		default: { width: 1, height: 1 },
	})
	const selectionAtom = model.silo.atom<string | null>({
		key: "prototype/selection",
		default: null,
	})
	const controlsAtom = model.silo.atom({
		key: "prototype/controls",
		default: true,
	})
	const getView = useGetter(viewAtom)
	const setView = useSetter(viewAtom)
	const getSize = useGetter(sizeAtom)
	const setSize = useSetter(sizeAtom)
	const getSelection = useGetter(selectionAtom)
	const setSelection = useSetter(selectionAtom)
	const getControls = useGetter(controlsAtom)
	const setControls = useSetter(controlsAtom)
	let surface: HTMLDivElement | null = null
	let stage: Konva.Stage | null = null
	let pan: {
		pointerId: number
		pointer: CanvasPoint
		view: CanvasView
	} | null = null
	const fit = () =>
		setView(fitCanvas(getScene().bounds, getSize(), model.yDirection))
	const select = (id: string, event: Konva.KonvaEventObject<PointerEvent>) => {
		event.cancelBubble = true
		setSelection(id)
		surface?.focus({ preventScroll: true })
	}
	onMount(() => {
		if (surface === null) return
		const measure = () => {
			const bounds = surface!.getBoundingClientRect()
			if (bounds.width <= 0 || bounds.height <= 0) return
			setSize({
				width: Math.round(bounds.width),
				height: Math.round(bounds.height),
			})
			fit()
		}
		const observer = new ResizeObserver(measure)
		observer.observe(surface)
		measure()
		const move = (event: PointerEvent) => {
			if (pan === null || event.pointerId !== pan.pointerId) return
			setView({
				...pan.view,
				x: pan.view.x + event.clientX - pan.pointer.x,
				y: pan.view.y + event.clientY - pan.pointer.y,
			})
		}
		const end = (event: PointerEvent) => {
			if (event.pointerId === pan?.pointerId) pan = null
		}
		window.addEventListener("pointermove", move)
		window.addEventListener("pointerup", end)
		window.addEventListener("pointercancel", end)
		onCleanup(() => {
			observer.disconnect()
			window.removeEventListener("pointermove", move)
			window.removeEventListener("pointerup", end)
			window.removeEventListener("pointercancel", end)
		})
	})
	return (
		<section
			className="canvas-panel"
			aria-label={`${model.title} canvas prototype`}
		>
			<header className="panel-heading">
				<div>
					<h2>{model.title}</h2>
					<p>{model.description}</p>
				</div>
				<span className="runtime-label">SPA + Konva</span>
			</header>
			<div className="toolbar">
				{model.choices.length > 0 ? (
					<label>
						Glyph
						<select
							aria-label="Glyph"
							value={getChoice()}
							onChange={(event) => {
								model.choose(event.currentTarget.value)
								setSelection(null)
								fit()
							}}
						>
							{model.choices.map((choice) => (
								<option key={choice.id} value={choice.id}>
									{choice.name}
								</option>
							))}
						</select>
					</label>
				) : (
					<span className="sample-label">create-design-logo</span>
				)}
				{model.masters.length > 0 ? (
					<label>
						Master
						<select
							aria-label="Master"
							value={getMaster()}
							onChange={(event) => {
								model.chooseMaster(event.currentTarget.value)
								fit()
							}}
						>
							{model.masters.map((master) => (
								<option key={master.id} value={master.id}>
									{master.name}
								</option>
							))}
						</select>
					</label>
				) : null}
				<button type="button" onClick={fit}>
					Fit
				</button>
				<button
					type="button"
					aria-pressed={getControls()}
					onClick={() => setControls((current) => !current)}
				>
					Nodes
				</button>
			</div>
			<div
				className="canvas-host"
				ref={(node) => {
					surface = node
				}}
				tabIndex={0}
				role="region"
				aria-label={`${model.title} interactive canvas`}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						pan = null
						setSelection(null)
					}
					if (
						(event.ctrlKey || event.metaKey) &&
						event.key.toLowerCase() === "z"
					) {
						event.preventDefault()
						if (event.shiftKey) model.silo.redo(model.getTimeline())
						else model.silo.undo(model.getTimeline())
					}
				}}
			>
				<Stage
					width={getSize().width}
					height={getSize().height}
					ref={(node) => {
						stage = node
						props.options.onStage?.(node)
					}}
					onPointerDown={(event) => {
						if (event.target !== stage || event.evt.button !== 0) return
						setSelection(null)
						surface?.focus({ preventScroll: true })
						pan = {
							pointerId: event.evt.pointerId,
							pointer: { x: event.evt.clientX, y: event.evt.clientY },
							view: getView(),
						}
					}}
					onWheel={(event: Konva.KonvaEventObject<WheelEvent>) => {
						event.evt.preventDefault()
						const focal = stage?.getPointerPosition()
						if (focal === null || focal === undefined) return
						const delta =
							event.evt.deltaY *
							(event.evt.deltaMode === 1
								? 16
								: event.evt.deltaMode === 2
									? getSize().height
									: 1)
						setView(
							zoomCanvasViewWithOptions(
								getView(),
								getView().zoom * Math.exp(-delta * 0.002),
								focal,
								{ baseScale: 1, minZoom: 0.01, maxZoom: 64 },
							),
						)
					}}
				>
					<Layer>
						<Group
							name="viewport"
							x={getView().x}
							y={getView().y}
							scaleX={getView().zoom}
							scaleY={getView().zoom * model.yDirection}
						>
							{getScene().objects.map((object) => (
								<SceneObject
									key={object.vector.id}
									object={object}
									model={model}
									zoom={getView().zoom}
									selected={getSelection() === object.vector.id}
									controls={getControls()}
									onSelect={select}
								/>
							))}
						</Group>
					</Layer>
				</Stage>
			</div>
			<div className="panel-footer">
				{[getChoice()].map((choice) => (
					<History key={choice} model={model} />
				))}
				<output aria-live="polite" aria-label="Selection">
					{getScene().objects.find(({ vector }) => vector.id === getSelection())
						?.vector.name ?? "No selection"}
				</output>
				<button
					type="button"
					onClick={() => {
						model.reset()
						setSelection(null)
						fit()
					}}
				>
					Reset sample
				</button>
			</div>
		</section>
	)
}

function SceneObject(props: {
	readonly object: CanvasObject
	readonly model: CanvasModel
	readonly zoom: number
	readonly selected: boolean
	readonly controls: boolean
	readonly onSelect: (
		id: string,
		event: Konva.KonvaEventObject<PointerEvent>,
	) => void
}): SpaElement {
	return (
		<Group
			name="canvas-object"
			id={props.object.vector.id}
			draggable={!props.object.vector.locked}
			onPointerDown={(event) => props.onSelect(props.object.vector.id, event)}
			onDragEnd={(event) => {
				if (event.target !== event.currentTarget) return
				const delta = event.target.position()
				event.target.position({ x: 0, y: 0 })
				props.model.moveObject(props.object.vector.id, delta)
			}}
		>
			<Path
				name="outline"
				data={vectorObjectPath(props.object.vector)}
				fill={props.object.fill ?? "transparent"}
				fillEnabled={props.object.fill !== undefined}
				stroke={props.object.stroke ?? "transparent"}
				strokeWidth={props.object.strokeWidth}
				lineCap={props.object.lineCap ?? "butt"}
				lineJoin={props.object.lineJoin ?? "miter"}
				hitStrokeWidth={Math.max(props.object.strokeWidth, 12 / props.zoom)}
			/>
			{props.selected ? (
				<Path
					name="selection-outline"
					data={vectorObjectPath(props.object.vector)}
					fillEnabled={false}
					stroke="#d35f3e"
					strokeWidth={1.5 / props.zoom}
					listening={false}
				/>
			) : null}
			{props.controls && props.selected
				? props.object.vector.contours.flatMap((contour) =>
						contour.nodes.map((node) => (
							<NodeControls
								key={`${contour.id}/${node.id}`}
								node={node}
								zoom={props.zoom}
								locked={Boolean(props.object.vector.locked)}
								onMove={(position, handle) =>
									props.model.moveNode(
										props.object.vector.id,
										node.id,
										position,
										handle,
									)
								}
							/>
						)),
					)
				: null}
		</Group>
	)
}

function NodeControls(props: {
	readonly node: VectorNode
	readonly zoom: number
	readonly locked: boolean
	readonly onMove: (position: CanvasPoint, handle?: VectorHandleKind) => void
}): SpaElement {
	return (
		<Group name="node-controls">
			{(["incoming", "outgoing"] as const).map((handle) =>
				props.node[handle] === undefined ? null : (
					<Group key={handle}>
						<Line
							points={[
								props.node.x,
								props.node.y,
								props.node.x + props.node[handle]!.x,
								props.node.y + props.node[handle]!.y,
							]}
							stroke="#989c91"
							strokeWidth={1 / props.zoom}
							listening={false}
						/>
						<Circle
							name={`handle-${handle}`}
							x={props.node.x + props.node[handle]!.x}
							y={props.node.y + props.node[handle]!.y}
							radius={3.5 / props.zoom}
							fill="#f7f6ee"
							stroke="#737d6b"
							strokeWidth={1 / props.zoom}
							draggable={!props.locked}
							onPointerDown={(event) => {
								event.cancelBubble = true
							}}
							onDragEnd={(event) => {
								event.cancelBubble = true
								props.onMove(event.target.position(), handle)
							}}
						/>
					</Group>
				),
			)}
			<Circle
				name="anchor"
				id={props.node.id}
				x={props.node.x}
				y={props.node.y}
				radius={4 / props.zoom}
				fill="#f7f6ee"
				stroke="#d35f3e"
				strokeWidth={1.5 / props.zoom}
				draggable={!props.locked}
				onPointerDown={(event) => {
					event.cancelBubble = true
				}}
				onDragEnd={(event) => {
					event.cancelBubble = true
					props.onMove(event.target.position())
				}}
			/>
		</Group>
	)
}
