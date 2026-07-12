import {
	createElement as createPreactElement,
	isValidElement,
	type ComponentChildren,
	type FunctionComponent,
	type VNode,
} from "preact"
import { useLayoutEffect, useRef } from "preact/hooks"
import React, {
	type ComponentProps,
	type ElementType,
	type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import {
	Circle as RawCircle,
	Group as RawGroup,
	Layer as RawLayer,
	Line as RawLine,
	Path as RawPath,
	Rect as RawRect,
	Stage as RawStage,
} from "react-konva"

type PreactDescriptorProps<Props> = Omit<Props, "children"> & {
	readonly children?: ComponentChildren
}

type Descriptor<Component extends ElementType> = FunctionComponent<
	PreactDescriptorProps<ComponentProps<Component>>
>

const rawTypes = new WeakMap<object, ElementType>()

function descriptor<Component extends ElementType>(
	rawType: Component,
): Descriptor<Component> {
	const marker = (): null => null
	rawTypes.set(marker, rawType)
	return marker as Descriptor<Component>
}

function childrenToReact(children: ComponentChildren): ReactNode[] {
	const values = Array.isArray(children) ? children : [children]
	return values.flatMap((child): ReactNode[] => {
		if (Array.isArray(child)) return childrenToReact(child)
		if (child === null || child === undefined || typeof child === "boolean") {
			return []
		}
		if (typeof child === "string" || typeof child === "number") return [child]
		if (!isValidElement(child)) {
			throw new TypeError(
				"Konva island children must be declarative shape nodes.",
			)
		}
		return [vnodeToReact(child)]
	})
}

function vnodeToReact(vnode: VNode): ReactNode {
	const rawType =
		typeof vnode.type === "object" || typeof vnode.type === "function"
			? rawTypes.get(vnode.type)
			: undefined
	if (rawType === undefined) {
		throw new TypeError(
			"A Preact component cannot cross the Konva React island.",
		)
	}
	const props = vnode.props as Readonly<Record<string, unknown>> & {
		readonly children?: ComponentChildren
	}
	const { children, ...rest } = props
	return React.createElement(
		rawType,
		{ ...rest, key: vnode.key === null ? undefined : vnode.key },
		...childrenToReact(children),
	)
}

type StageProps = PreactDescriptorProps<ComponentProps<typeof RawStage>>

/**
 * A real React 18 root isolates react-konva's private reconciler from Preact.
 * Only plain props, callbacks, and declarative Konva descriptors cross over.
 */
const StageHost = ({ children, ...stageProps }: StageProps) => {
	const hostRef = useRef<HTMLElement>(null)
	const rootRef = useRef<Root | null>(null)
	useLayoutEffect(() => {
		const host = hostRef.current
		if (host === null) return
		const root = createRoot(host)
		rootRef.current = root
		return () => {
			root.unmount()
			rootRef.current = null
		}
	}, [])
	useLayoutEffect(() => {
		rootRef.current?.render(
			React.createElement(RawStage, stageProps, ...childrenToReact(children)),
		)
	})
	return createPreactElement("react-konva-stage", {
		ref: hostRef,
		style: { display: "block", width: "100%", height: "100%" },
	})
}

export const Stage = StageHost
export const Circle = descriptor(RawCircle)
export const Group = descriptor(RawGroup)
export const Layer = descriptor(RawLayer)
export const Line = descriptor(RawLine)
export const Path = descriptor(RawPath)
export const Rect = descriptor(RawRect)
