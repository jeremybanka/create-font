import {
	CursorArrowIcon,
	DotFilledIcon,
	Pencil2Icon,
	PlusIcon,
	ResetIcon,
	TransformIcon,
} from "@radix-ui/react-icons"

import css from "./EditorIcon.module.css"

export type EditorIconName =
	| "add"
	| "make-first"
	| "pen"
	| "redo"
	| "reverse"
	| "select"
	| "transform"
	| "undo"

const EDITOR_ICONS = {
	add: PlusIcon,
	"make-first": DotFilledIcon,
	pen: Pencil2Icon,
	redo: ResetIcon,
	reverse: ResetIcon,
	select: CursorArrowIcon,
	transform: TransformIcon,
	undo: ResetIcon,
} as const

export function EditorIcon({ name }: { readonly name: EditorIconName }) {
	const Icon = EDITOR_ICONS[name]
	return (
		<editor-icon className={css.class}>
			<Icon
				aria-hidden="true"
				style={name === "redo" ? { transform: "scaleX(-1)" } : undefined}
			/>
		</editor-icon>
	)
}
