import type { KonvaEventListener, Node, NodeConfig } from "konva/lib/Node"

const eventNames = {
	onMouseOver: "mouseover",
	onMouseMove: "mousemove",
	onMouseOut: "mouseout",
	onMouseEnter: "mouseenter",
	onMouseLeave: "mouseleave",
	onMouseDown: "mousedown",
	onMouseUp: "mouseup",
	onWheel: "wheel",
	onClick: "click",
	onDblClick: "dblclick",
	onTouchStart: "touchstart",
	onTouchMove: "touchmove",
	onTouchEnd: "touchend",
	onTap: "tap",
	onDblTap: "dbltap",
	onDragStart: "dragstart",
	onDragMove: "dragmove",
	onDragEnd: "dragend",
	onTransform: "transform",
	onTransformStart: "transformstart",
	onTransformEnd: "transformend",
	onContextMenu: "contextmenu",
	onPointerDown: "pointerdown",
	onPointerMove: "pointermove",
	onPointerUp: "pointerup",
	onPointerCancel: "pointercancel",
	onPointerEnter: "pointerenter",
	onPointerLeave: "pointerleave",
	onPointerOver: "pointerover",
	onPointerOut: "pointerout",
	onPointerClick: "pointerclick",
	onPointerDblClick: "pointerdblclick",
	onGotPointerCapture: "gotpointercapture",
	onLostPointerCapture: "lostpointercapture",
} as const

export type EventPropName = keyof typeof eventNames

type UnknownEventListener = KonvaEventListener<Node, Event>

export interface NodePropsSnapshot {
	readonly attributes: Readonly<Record<string, unknown>>
	readonly events: Readonly<
		Partial<Record<EventPropName, UnknownEventListener>>
	>
}

const emptySnapshot: NodePropsSnapshot = {
	attributes: {},
	events: {},
}

export function snapshotNodeProps(
	props: Readonly<Record<string, unknown>>,
): NodePropsSnapshot {
	const attributes: Record<string, unknown> = {}
	const events: Partial<Record<EventPropName, UnknownEventListener>> = {}
	for (const [name, value] of Object.entries(props)) {
		if (name === "children" || name === "ref" || name === "__konvaIndex") {
			continue
		}
		if (name in eventNames) {
			if (typeof value === "function") {
				events[name as EventPropName] = value as UnknownEventListener
			}
			continue
		}
		attributes[name] = value
	}
	return { attributes, events }
}

export function applyNodeProps(
	node: Node,
	previous: NodePropsSnapshot = emptySnapshot,
	next: NodePropsSnapshot,
): void {
	const changedAttributes: Record<string, unknown> = {}
	for (const name of Object.keys(previous.attributes)) {
		if (!(name in next.attributes)) changedAttributes[name] = undefined
	}
	for (const [name, value] of Object.entries(next.attributes)) {
		if (previous.attributes[name] !== value) changedAttributes[name] = value
	}
	if (Object.keys(changedAttributes).length > 0) {
		node.setAttrs(changedAttributes as NodeConfig)
	}

	for (const [propName, eventName] of Object.entries(eventNames) as Array<
		[EventPropName, (typeof eventNames)[EventPropName]]
	>) {
		const previousListener = previous.events[propName]
		const nextListener = next.events[propName]
		if (previousListener === nextListener) continue
		const namespacedEvent = `${eventName}.preactKonva`
		node.off(namespacedEvent)
		if (nextListener !== undefined) node.on(namespacedEvent, nextListener)
	}
}

export function clearNodeProps(node: Node): void {
	node.off(".preactKonva")
}
