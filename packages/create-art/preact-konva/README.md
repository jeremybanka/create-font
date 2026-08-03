# @create-art/preact-konva

Small, native Preact bindings for the Konva scene graph.

`@create-art/preact-konva` provides a deliberately narrow declarative layer for interactive
browser canvases. It creates ordinary Konva nodes, applies changed properties,
keeps JSX child order synchronized with Konva z-order, manages event listeners,
and exposes the underlying nodes through refs.

## Install

```sh
npm install @create-art/preact-konva preact konva
```

Both Preact and Konva are peer dependencies so the application and adapter use
the same framework and scene-graph instances.

## Example

```tsx
import { useRef } from "preact/hooks"
import type Konva from "konva"
import { Circle, Layer, Stage } from "@create-art/preact-konva"

export function Canvas() {
	const circle = useRef<Konva.Circle>(null)

	return (
		<Stage width={640} height={480}>
			<Layer>
				<Circle
					ref={circle}
					x={320}
					y={240}
					radius={48}
					fill="tomato"
					draggable
				/>
			</Layer>
		</Stage>
	)
}
```

## API

The package currently exports typed components for:

- `Stage`
- `Layer`
- `Group`
- `Rect`
- `Circle`
- `Line`
- `Path`
- `Text`

It also exports `KonvaEventObject` and the component/event prop types. Konva
properties and `onMouseDown`/`onPointerMove`-style event props are forwarded to
their nodes. Container children must be `@create-art/preact-konva` components; shape
components cannot contain children.

The `Stage` component owns its browser host and therefore does not support
server rendering. Import Konva directly for headless canvas work.

## Scope

This is not intended to reproduce every feature of `react-konva`. Its small API
matches the primitives required by the create-font and create-design editors.
New nodes and events are added explicitly so the supported surface stays typed,
testable, and tree-shakeable.

The Create Art project is separately evaluating whether to migrate its editor
runtime to React and the externally maintained `react-konva` renderer in
[create-font issue #366](https://github.com/jeremybanka/create-font/issues/366).

## License

Mozilla Public License 2.0. See [LICENSE](LICENSE).
