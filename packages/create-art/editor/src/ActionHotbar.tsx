import { PlusIcon } from "@radix-ui/react-icons"
import type * as React from "react"
import { useEffect, useRef, useState } from "react"

import {
	assignHotbarSlot,
	HOTBAR_COMMAND_MIME,
	HOTBAR_KEYS,
	hotbarSlotIndexForKeyboardEvent,
	swapHotbarSlots,
	type HotbarKind,
	type HotbarSlots,
} from "./command-assignment.ts"
import css from "./ActionHotbar.module.css"
import { EditorIcon } from "./EditorIcon.tsx"
import type { PaletteCommand } from "./command-palette.ts"
import { ALT_KEY_LABEL } from "./platform.ts"
import { TooltipButton } from "./TooltipButton.tsx"

const svg = {
	Plus: PlusIcon,
}

const HOTBAR_SLOT_MIME = "application/x-create-art-hotbar-slot"

export interface ActionHotbarProps {
	readonly alternateSlots: HotbarSlots
	readonly commands: readonly PaletteCommand[]
	readonly enabled: boolean
	readonly paletteOpen: boolean
	readonly slots: HotbarSlots
	readonly onAlternateAssignCommand: (
		commandId: string,
		slotIndex: number,
	) => void
	readonly onAlternateSlotsChange: (slots: HotbarSlots) => void
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
	alternateSlots,
	commands,
	enabled,
	paletteOpen,
	slots,
	onAlternateAssignCommand,
	onAlternateSlotsChange,
	onAssignCommand,
	onOpenCommands,
	onSlotsChange,
}: ActionHotbarProps) {
	const slotsRef = useRef(slots)
	slotsRef.current = slots
	const alternateSlotsRef = useRef(alternateSlots)
	alternateSlotsRef.current = alternateSlots
	const [alternateActive, setAlternateActive] = useState(false)

	useEffect(() => {
		const pressedAltCodes = new Set<string>()
		const reset = (): void => {
			pressedAltCodes.clear()
			setAlternateActive(false)
		}
		const handleModifierKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Alt") {
				pressedAltCodes.add(event.code || "Alt")
				setAlternateActive(true)
			} else if (!event.altKey && pressedAltCodes.size > 0) {
				reset()
			}
		}
		const handleModifierKeyUp = (event: KeyboardEvent): void => {
			if (event.key !== "Alt") return
			pressedAltCodes.delete(event.code || "Alt")
			if (pressedAltCodes.size === 0 || !event.altKey) reset()
		}
		const handleVisibilityChange = (): void => {
			if (document.visibilityState !== "visible") reset()
		}
		window.addEventListener("keydown", handleModifierKeyDown)
		window.addEventListener("keyup", handleModifierKeyUp)
		window.addEventListener("blur", reset)
		document.addEventListener("visibilitychange", handleVisibilityChange)
		return () => {
			window.removeEventListener("keydown", handleModifierKeyDown)
			window.removeEventListener("keyup", handleModifierKeyUp)
			window.removeEventListener("blur", reset)
			document.removeEventListener("visibilitychange", handleVisibilityChange)
		}
	}, [])

	useEffect(() => {
		if (!enabled) return
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) return
			const kind: HotbarKind = event.altKey ? "alternate" : "primary"
			const index = hotbarSlotIndexForKeyboardEvent(event, kind)
			if (index === null) return
			const commandId =
				kind === "alternate"
					? alternateSlotsRef.current[index]
					: slotsRef.current[index]
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
		kind: HotbarKind,
		slotIndex: number,
	): void => {
		event.preventDefault()
		const commandId = event.dataTransfer?.getData(HOTBAR_COMMAND_MIME) ?? ""
		if (commandId.length > 0) {
			if (kind === "alternate") onAlternateAssignCommand(commandId, slotIndex)
			else onAssignCommand(commandId, slotIndex)
			return
		}
		const [sourceKind, sourceIndexValue] = (
			event.dataTransfer?.getData(HOTBAR_SLOT_MIME) ?? ""
		).split(":")
		const sourceIndex = Number(sourceIndexValue)
		if (!Number.isInteger(sourceIndex)) return
		const targetSlots = kind === "alternate" ? alternateSlots : slots
		if (sourceKind === kind) {
			const next = swapHotbarSlots(targetSlots, sourceIndex, slotIndex)
			if (kind === "alternate") onAlternateSlotsChange(next)
			else onSlotsChange(next)
			return
		}
		const sourceSlots = sourceKind === "alternate" ? alternateSlots : slots
		const sourceCommandId = sourceSlots[sourceIndex]
		if (sourceCommandId === null || sourceCommandId === undefined) return
		// Cross-bar dragging deliberately copies. It never clears or reorders the
		// source bar, keeping the two persisted layouts independent.
		const next = assignHotbarSlot(targetSlots, slotIndex, sourceCommandId)
		if (kind === "alternate") onAlternateSlotsChange(next)
		else onSlotsChange(next)
	}

	const renderHotbar = (kind: HotbarKind, hotbarSlots: HotbarSlots) => (
		<action-hotbar
			className={css.class}
			aria-label={
				kind === "alternate" ? "Alternate action hotbar" : "Action hotbar"
			}
			aria-hidden={
				kind === "alternate" && !alternateActive ? "true" : undefined
			}
			data-hotbar-kind={kind}
			data-visible={
				kind === "alternate" && alternateActive ? "true" : undefined
			}
			inert={kind === "alternate" && !alternateActive}
		>
			{HOTBAR_KEYS.map((key, index) => {
				const commandId = hotbarSlots[index]
				const command = commands.find((candidate) => candidate.id === commandId)
				const altLabel = kind === "alternate" ? `${ALT_KEY_LABEL}+` : ""
				const shortcut = {
					ariaKeyShortcuts: kind === "alternate" ? `Alt+${key}` : key,
					keycaps: kind === "alternate" ? [ALT_KEY_LABEL, key] : [key],
				}
				return (
					<hotbar-slot
						key={key}
						data-empty={command === undefined ? "true" : "false"}
						draggable={command !== undefined}
						onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
							event.preventDefault()
							const next = assignHotbarSlot(hotbarSlots, index, null)
							if (kind === "alternate") onAlternateSlotsChange(next)
							else onSlotsChange(next)
						}}
						onDragStart={(event: React.DragEvent<HTMLElement>) => {
							if (command === undefined || event.dataTransfer === null) return
							event.dataTransfer.effectAllowed = "move"
							event.dataTransfer.setData(HOTBAR_SLOT_MIME, `${kind}:${index}`)
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
							dropIntoSlot(event, kind, index)
						}
					>
						{command === undefined ? (
							<TooltipButton
								label={`Assign ${kind === "alternate" ? "alternate " : ""}hotbar slot ${altLabel}${key}`}
								description={
									kind === "alternate"
										? `Open the Command Palette, hold ${ALT_KEY_LABEL}, then drag a command here.`
										: "Open the Command Palette, then drag a command here or press Mod+Enter and choose this key."
								}
								shortcut={shortcut}
								placement="top"
								onClick={onOpenCommands}
							>
								<svg.Plus aria-hidden="true" />
							</TooltipButton>
						) : (
							<TooltipButton
								label={command.displayName}
								description={`${command.disabledReason ?? command.description ?? command.category} Assigned to ${altLabel}${key}${command.shortcut === undefined ? "" : `; also ${command.shortcut}`}. Right-click to clear.`}
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

	return (
		<action-hotbar-group
			className={css.class}
			data-alternate-active={alternateActive ? "true" : "false"}
			data-palette-open={paletteOpen ? "true" : "false"}
		>
			{renderHotbar("alternate", alternateSlots)}
			{renderHotbar("primary", slots)}
		</action-hotbar-group>
	)
}
