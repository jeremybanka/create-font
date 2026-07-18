import {
	AlignCenterVerticallyIcon,
	CursorArrowIcon,
	DotFilledIcon,
	Half2Icon,
	Link1Icon,
	LinkBreak1Icon,
	Pencil1Icon,
	PlusIcon,
	CircleIcon,
	DoubleArrowLeftIcon,
	DoubleArrowRightIcon,
	ShuffleIcon,
	StarIcon,
	SquareIcon,
	TransformIcon,
} from "@radix-ui/react-icons"
import type * as Radix from "@radix-ui/react-icons"

import css from "./EditorIcon.module.css"

export type EditorIconName = keyof typeof EDITOR_ICONS

const EDITOR_ICONS = {
	AlignCenterVerticallyIcon,
	CursorArrowIcon,
	DotFilledIcon,
	Half2Icon,
	Link1Icon,
	LinkBreak1Icon,
	Pencil1Icon,
	PlusIcon,
	CircleIcon,
	DoubleArrowLeftIcon,
	DoubleArrowRightIcon,
	ShuffleIcon,
	StarIcon,
	SquareIcon,
	TransformIcon,
} as const satisfies Partial<typeof Radix>

export function EditorIcon({ name }: { readonly name: EditorIconName }) {
	const Icon = EDITOR_ICONS[name]
	return (
		<editor-icon className={css.class}>
			<Icon aria-hidden="true" />
		</editor-icon>
	)
}
