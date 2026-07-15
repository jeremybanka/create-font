import {
	CursorArrowIcon,
	Pencil2Icon,
	PlusIcon,
	ResetIcon,
} from "@radix-ui/react-icons"

import css from "./EditorIcon.module.css"

export type EditorIconName = "add" | "pen" | "redo" | "select" | "undo"

const EDITOR_ICONS = {
	add: PlusIcon,
	pen: Pencil2Icon,
	redo: ResetIcon,
	select: CursorArrowIcon,
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
