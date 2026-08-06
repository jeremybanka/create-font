/* eslint-disable lasertag/render-tag-with-own-name -- This compatibility adapter delegates DOM ownership to the shared TooltipButton. */
import {
	TooltipButton as SharedTooltipButton,
	type TooltipButtonProps as SharedTooltipButtonProps,
} from "@create-art/editor"
import type { Ref } from "react"

import {
	ariaKeyShortcut,
	formatHotkey,
	type Hotkey,
} from "./editor-tools-and-hotkeys.ts"

type TooltipButtonProps = Omit<SharedTooltipButtonProps, "shortcut"> &
	Readonly<{
		buttonRef?: Ref<HTMLButtonElement>
		description: string
		disabled?: boolean
		disabledReason?: string | undefined
		hotkey?: Hotkey
		label: string
	}>

export function TooltipButton({
	buttonRef,
	children,
	description,
	disabled = false,
	disabledReason,
	hotkey,
	label,
	onBlur,
	onClick,
	onFocus,
	onKeyDown,
	placement = "right",
	...buttonProps
}: TooltipButtonProps) {
	const keycaps = hotkey === undefined ? [] : formatHotkey(hotkey)
	return (
		<SharedTooltipButton
			{...buttonProps}
			{...(buttonRef === undefined ? {} : { buttonRef })}
			description={description}
			disabled={disabled}
			disabledReason={disabledReason}
			label={label}
			onBlur={onBlur}
			onClick={onClick}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			placement={placement}
			{...(hotkey === undefined
				? {}
				: {
						shortcut: {
							ariaKeyShortcuts: ariaKeyShortcut(hotkey),
							keycaps,
						},
					})}
		>
			{children}
		</SharedTooltipButton>
	)
}
