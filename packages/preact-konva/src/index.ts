import {
	cloneElement,
	createContext,
	createElement,
	Fragment,
	isValidElement,
	toChildArray,
	type ComponentChild,
	type ComponentChildren,
	type FunctionComponent,
	type JSX,
	type Ref,
	type VNode,
} from "preact"
import { forwardRef } from "preact/compat"
import {
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "preact/hooks"
import Konva from "konva/lib/Core"
import { type Container } from "konva/lib/Container"
import { type GroupConfig } from "konva/lib/Group"
import { type LayerConfig } from "konva/lib/Layer"
import {
	type KonvaEventObject,
	type Node,
	type NodeConfig,
} from "konva/lib/Node"
import {
	Circle as KonvaCircle,
	type CircleConfig,
} from "konva/lib/shapes/Circle"
import { Line as KonvaLine, type LineConfig } from "konva/lib/shapes/Line"
import { Path as KonvaPath, type PathConfig } from "konva/lib/shapes/Path"
import { Rect as KonvaRect, type RectConfig } from "konva/lib/shapes/Rect"
import { Text as KonvaText, type TextConfig } from "konva/lib/shapes/Text"
import { type StageConfig } from "konva/lib/Stage"
import {
	applyNodeProps,
	clearNodeProps,
	snapshotNodeProps,
	type NodePropsSnapshot,
} from "./node-props.ts"

export type { KonvaEventObject } from "konva/lib/Node"

export interface KonvaNodeEvents<NodeType extends Node = Node> {
	onMouseOver?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseMove?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseOut?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseEnter?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseLeave?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseDown?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onMouseUp?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onWheel?(event: KonvaEventObject<WheelEvent, NodeType>): void
	onClick?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onDblClick?(event: KonvaEventObject<MouseEvent, NodeType>): void
	onTouchStart?(event: KonvaEventObject<TouchEvent, NodeType>): void
	onTouchMove?(event: KonvaEventObject<TouchEvent, NodeType>): void
	onTouchEnd?(event: KonvaEventObject<TouchEvent, NodeType>): void
	onTap?(event: KonvaEventObject<MouseEvent | TouchEvent, NodeType>): void
	onDblTap?(event: KonvaEventObject<MouseEvent | TouchEvent, NodeType>): void
	onDragStart?(event: KonvaEventObject<DragEvent, NodeType>): void
	onDragMove?(event: KonvaEventObject<DragEvent, NodeType>): void
	onDragEnd?(event: KonvaEventObject<DragEvent, NodeType>): void
	onTransform?(event: KonvaEventObject<Event, NodeType>): void
	onTransformStart?(event: KonvaEventObject<Event, NodeType>): void
	onTransformEnd?(event: KonvaEventObject<Event, NodeType>): void
	onContextMenu?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerDown?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerMove?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerUp?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerCancel?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerEnter?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerLeave?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerOver?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerOut?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerClick?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onPointerDblClick?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onGotPointerCapture?(event: KonvaEventObject<PointerEvent, NodeType>): void
	onLostPointerCapture?(event: KonvaEventObject<PointerEvent, NodeType>): void
}

type KonvaChildren = {
	readonly children?: ComponentChildren
}

export type KonvaNodeProps<Config, NodeType extends Node> = Config &
	KonvaNodeEvents<NodeType> &
	KonvaChildren

export interface KonvaNodeComponent<
	NodeType extends Node,
	Props,
> extends FunctionComponent<Props & { readonly ref?: Ref<NodeType> }> {}

type InternalNodeProps<Config, NodeType extends Node> = KonvaNodeProps<
	Config,
	NodeType
> & {
	readonly __konvaIndex?: number
}

type NodeConstructor<NodeType extends Node, Config> = new (
	config?: Config,
) => NodeType

const ParentContext = createContext<Container | null>(null)

function orderedChildren(children: ComponentChildren): ComponentChild[] {
	return toChildArray(children).map((child, index) => {
		if (!isValidElement(child)) {
			throw new TypeError(
				"Konva containers only accept Konva component children.",
			)
		}
		return cloneElement(child as VNode<Record<string, unknown>>, {
			__konvaIndex: index,
		})
	})
}

function assignRef<NodeType extends Node>(
	ref: Ref<NodeType> | undefined,
	value: NodeType | null,
): void {
	if (typeof ref === "function") ref(value)
	else if (ref !== null && ref !== undefined) ref.current = value
}

function useNodeProps(
	node: Node,
	props: Readonly<Record<string, unknown>>,
): void {
	const previousRef = useRef<NodePropsSnapshot>()
	useLayoutEffect(() => {
		const next = snapshotNodeProps(props)
		applyNodeProps(node, previousRef.current, next)
		previousRef.current = next
	})
	useLayoutEffect(
		() => () => {
			clearNodeProps(node)
		},
		[node],
	)
}

function createNodeComponent<NodeType extends Node, Config extends NodeConfig>(
	displayName: string,
	NodeClass: NodeConstructor<NodeType, Config>,
	providesParent = false,
): KonvaNodeComponent<NodeType, KonvaNodeProps<Config, NodeType>> {
	const Component = forwardRef<NodeType, InternalNodeProps<Config, NodeType>>(
		(props, forwardedRef) => {
			const parent = useContext(ParentContext)
			if (parent === null) {
				throw new Error(
					`${displayName} must be rendered inside a Konva container.`,
				)
			}
			const node = useMemo(() => new NodeClass(), [])
			const { children, __konvaIndex = 0, ...nodeProps } = props
			useNodeProps(node, nodeProps)

			useLayoutEffect(() => {
				parent.add(node)
				return () => node.destroy()
			}, [node, parent])
			useLayoutEffect(() => {
				if (node.parent === parent) node.zIndex(__konvaIndex)
			}, [__konvaIndex, node, parent])
			useLayoutEffect(() => {
				assignRef(forwardedRef, node)
				return () => assignRef(forwardedRef, null)
			}, [forwardedRef, node])

			const renderedChildren = orderedChildren(children)
			if (!providesParent) {
				if (renderedChildren.length > 0) {
					throw new TypeError(`${displayName} cannot contain Konva children.`)
				}
				return null
			}
			return createElement(ParentContext.Provider, {
				children: renderedChildren,
				value: node as unknown as Container,
			})
		},
	)
	Component.displayName = displayName
	return Component as KonvaNodeComponent<
		NodeType,
		KonvaNodeProps<Config, NodeType>
	>
}

type StageHostProps = Pick<
	JSX.HTMLAttributes<HTMLDivElement>,
	"className" | "role" | "style" | "tabIndex" | "title"
>

export type StageProps = Omit<StageConfig, "container"> &
	KonvaNodeEvents<Konva.Stage> &
	KonvaChildren &
	StageHostProps

interface MountedStageProps {
	readonly children?: ComponentChildren
	readonly nodeProps: Readonly<Record<string, unknown>>
	readonly stage: Konva.Stage
}

const MountedStage = ({ children, nodeProps, stage }: MountedStageProps) => {
	useNodeProps(stage, nodeProps)
	return createElement(
		ParentContext.Provider,
		{ value: stage },
		orderedChildren(children),
	)
}

export const Stage = forwardRef<Konva.Stage, StageProps>(
	(props, forwardedRef) => {
		const { children, className, role, style, tabIndex, title, ...nodeProps } =
			props
		const hostRef = useRef<HTMLDivElement>(null)
		const [stage, setStage] = useState<Konva.Stage | null>(null)
		const initialNodePropsRef = useRef(nodeProps)

		useLayoutEffect(() => {
			const host = hostRef.current
			if (host === null) return
			const initialAttributes = snapshotNodeProps(
				initialNodePropsRef.current,
			).attributes
			const mountedStage = new Konva.Stage({
				...(initialAttributes as Omit<StageConfig, "container">),
				container: host,
			})
			setStage(mountedStage)
			return () => mountedStage.destroy()
		}, [])
		useLayoutEffect(() => {
			assignRef(forwardedRef, stage)
			return () => assignRef(forwardedRef, null)
		}, [forwardedRef, stage])

		const hostStyle =
			typeof style === "string"
				? `display:block;width:100%;height:100%;${style}`
				: { display: "block", width: "100%", height: "100%", ...style }

		return createElement(
			Fragment,
			null,
			createElement("div", {
				ref: hostRef,
				className,
				role,
				style: hostStyle,
				tabIndex,
				title,
			}),
			stage === null
				? null
				: createElement(MountedStage, {
						children,
						nodeProps,
						stage,
					}),
		)
	},
)
Stage.displayName = "Stage"

export const Layer = createNodeComponent<Konva.Layer, LayerConfig>(
	"Layer",
	Konva.Layer,
	true,
)
export const Group = createNodeComponent<Konva.Group, GroupConfig>(
	"Group",
	Konva.Group,
	true,
)
export const Rect = createNodeComponent<KonvaRect, RectConfig>(
	"Rect",
	KonvaRect,
)
export const Circle = createNodeComponent<KonvaCircle, CircleConfig>(
	"Circle",
	KonvaCircle,
)
export const Line = createNodeComponent<KonvaLine, LineConfig>(
	"Line",
	KonvaLine,
)
export const Path = createNodeComponent<KonvaPath, PathConfig>(
	"Path",
	KonvaPath,
)
export const Text = createNodeComponent<KonvaText, TextConfig>(
	"Text",
	KonvaText,
)
