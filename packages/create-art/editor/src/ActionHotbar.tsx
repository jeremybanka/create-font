import { PlusIcon } from "@radix-ui/react-icons"
import type * as React from "react"
import { useEffect, useRef } from "react"

import {
	assignHotbarSlot,
	HOTBAR_COMMAND_MIME,
	HOTBAR_KEYS,
	hotbarSlotIndexForKeyboardEvent,
	swapHotbarSlots,
	type HotbarSlots,
} from "./command-assignment.ts"
import css from "./ActionHotbar.module.css"
import { EditorIcon } from "./EditorIcon.tsx"
import type { PaletteCommand } from "./command-palette.ts"
import { TooltipButton } from "./TooltipButton.tsx"

const svg = {
	Plus: PlusIcon,
}

const HOTBAR_SLOT_MIME = "application/x-create-art-hotbar-slot"

export interface ActionHotbarProps {
	readonly commands: readonly PaletteCommand[]
	readonly enabled: boolean
	readonly paletteOpen: boolean
	readonly slots: HotbarSlots
	readonly onAssignCommand: (commandId: string, slotIndex: number) => void
	readonly onOpenCommands: () => void
	readonly onSlotsChange: (slots: HotbarSlots) => void
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

export function ActionHotbar({
	commands,
	enabled,
	paletteOpen,
	slots,
	onAssignCommand,
	onOpenCommands,
	onSlotsChange,
}: ActionHotbarProps) {
	const slotsRef = useRef(slots)
	slotsRef.current = slots

	useEffect(() => {
		if (!enabled) return
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) return
			const index = hotbarSlotIndexForKeyboardEvent(event)
			if (index === null) return
			const commandId = slotsRef.current[index]
			if (commandId === null || commandId === undefined) return
			const command = commands.find((candidate) => candidate.id === commandId)
			if (command === undefined) return
			event.preventDefault()
			if (!command.disabled) command.do()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [commands, enabled])

	const dropIntoSlot = (
		event: React.DragEvent<HTMLElement>,
		slotIndex: number,
	): void => {
		event.preventDefault()
		const commandId = event.dataTransfer?.getData(HOTBAR_COMMAND_MIME) ?? ""
		if (commandId.length > 0) {
			onAssignCommand(commandId, slotIndex)
			return
		}
		const source = Number(
			event.dataTransfer?.getData(HOTBAR_SLOT_MIME) ?? Number.NaN,
		)
		if (Number.isInteger(source))
			onSlotsChange(swapHotbarSlots(slots, source, slotIndex))
	}

	return (
		<action-hotbar
			className={css.class}
			aria-label="Action hotbar"
			data-palette-open={paletteOpen ? "true" : "false"}
		>
			{HOTBAR_KEYS.map((key, index) => {
				const commandId = slots[index]
				const command = commands.find((candidate) => candidate.id === commandId)
				const shortcut = {
					ariaKeyShortcuts: key,
					keycaps: [key],
				}
				return (
					<hotbar-slot
						key={key}
						data-empty={command === undefined ? "true" : "false"}
						draggable={command !== undefined}
						onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
							event.preventDefault()
							onSlotsChange(assignHotbarSlot(slots, index, null))
						}}
						onDragStart={(event: React.DragEvent<HTMLElement>) => {
							if (command === undefined || event.dataTransfer === null) return
							event.dataTransfer.effectAllowed = "move"
							event.dataTransfer.setData(HOTBAR_SLOT_MIME, String(index))
						}}
						onDragOver={(event: React.DragEvent<HTMLElement>) => {
							event.preventDefault()
							if (event.dataTransfer !== null) {
								event.dataTransfer.dropEffect =
									event.dataTransfer.types.includes(HOTBAR_COMMAND_MIME)
										? "copy"
										: "move"
							}
						}}
						onDrop={(event: React.DragEvent<HTMLElement>) =>
							dropIntoSlot(event, index)
						}
					>
						{command === undefined ? (
							<TooltipButton
								label={`Assign hotbar slot ${key}`}
								description="Open the Command Palette, then drag a command here or press Mod+Enter and choose this key."
								shortcut={shortcut}
								placement="top"
								onClick={onOpenCommands}
							>
								<svg.Plus aria-hidden="true" />
							</TooltipButton>
						) : (
							<TooltipButton
								label={command.displayName}
								description={`${command.disabledReason ?? command.description ?? command.category} Assigned to ${key}${command.shortcut === undefined ? "" : `; also ${command.shortcut}`}. Right-click to clear.`}
								shortcut={shortcut}
								placement="top"
								aria-pressed={command.checked}
								aria-disabled={command.disabled}
								data-disabled={command.disabled ? "true" : "false"}
								onClick={() => {
									if (!command.disabled) command.do()
								}}
							>
								<EditorIcon name={command.icon} />
							</TooltipButton>
						)}
						<kbd aria-hidden="true">{key}</kbd>
					</hotbar-slot>
				)
			})}
		</action-hotbar>
	)
}
