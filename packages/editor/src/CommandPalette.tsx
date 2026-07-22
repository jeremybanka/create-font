import {
	ArrowDownIcon,
	ArrowUpIcon,
	EnterIcon,
	MagnifyingGlassIcon,
} from "@radix-ui/react-icons"
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

import {
	filterPaletteCommands,
	nextCommandId,
	type PaletteCommand,
} from "./command-palette.ts"
import {
	HOTBAR_COMMAND_MIME,
	HOTBAR_KEYS,
	hotbarSlotIndexForKeyboardEvent,
} from "./action-hotbar.ts"
import css from "./CommandPalette.module.css"
import { EditorIcon } from "./EditorIcon.tsx"
import { IS_MAC_LIKE, MOD_KEY_LABEL } from "./editor-tools-and-hotkeys.ts"

const svg = {
	ArrowDown: ArrowDownIcon,
	ArrowUp: ArrowUpIcon,
	Enter: EnterIcon,
	MagnifyingGlass: MagnifyingGlassIcon,
}

export interface CommandPaletteProps {
	readonly commands: readonly PaletteCommand[]
	readonly onCancel: () => void
	readonly onExecute: (command: PaletteCommand) => void
	readonly onAssign: (command: PaletteCommand, slotIndex: number) => void
}

export function CommandPalette({
	commands,
	onCancel,
	onExecute,
	onAssign,
}: CommandPaletteProps) {
	const [query, setQuery] = useState("")
	const [activeId, setActiveId] = useState<string | null>(
		nextCommandId(commands, null, 1),
	)
	const [assignmentCommand, setAssignmentCommand] =
		useState<PaletteCommand | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const filteredCommands = filterPaletteCommands(commands, query)
	const activeCommand = filteredCommands.find(
		(command) => command.id === activeId,
	)

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		})
		return () => cancelAnimationFrame(frame)
	}, [])

	const updateQuery = (value: string): void => {
		const matches = filterPaletteCommands(commands, value)
		setQuery(value)
		setActiveId(nextCommandId(matches, null, 1))
	}
	const execute = (command: PaletteCommand | undefined): void => {
		if (command === undefined || command.disabled) return
		onExecute(command)
	}
	const handleKeyDown = (
		event: JSX.TargetedKeyboardEvent<HTMLInputElement>,
	): void => {
		if (assignmentCommand !== null) {
			event.preventDefault()
			if (event.key === "Escape") {
				setAssignmentCommand(null)
				return
			}
			const slotIndex = hotbarSlotIndexForKeyboardEvent(event)
			if (slotIndex !== null) onAssign(assignmentCommand, slotIndex)
			return
		}
		if (event.key === "Escape") {
			event.preventDefault()
			onCancel()
			return
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			setActiveId(
				nextCommandId(
					filteredCommands,
					activeId,
					event.key === "ArrowDown" ? 1 : -1,
				),
			)
			return
		}
		if (event.key === "Enter") {
			event.preventDefault()
			const mod = IS_MAC_LIKE
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey
			if (mod && !event.shiftKey && !event.altKey) {
				if (activeCommand !== undefined) setAssignmentCommand(activeCommand)
			} else {
				execute(activeCommand)
			}
		}
	}

	return (
		<command-palette
			className={css.class}
			onMouseDown={(event: JSX.TargetedMouseEvent<HTMLElement>) => {
				if (event.target === event.currentTarget) onCancel()
			}}
		>
			<command-palette-dialog role="dialog" aria-label="Command Palette">
				<command-search>
					<svg.MagnifyingGlass aria-hidden="true" />
					<input
						ref={inputRef}
						role="combobox"
						aria-label="Search commands"
						aria-autocomplete="list"
						aria-expanded="true"
						aria-controls="command-palette-results"
						aria-activedescendant={
							activeCommand === undefined
								? undefined
								: `command-${activeCommand.id}`
						}
						value={query}
						placeholder="Type a command"
						autocomplete="off"
						onInput={(event) => updateQuery(event.currentTarget.value)}
						onKeyDown={handleKeyDown}
					/>
					<kbd>Esc</kbd>
				</command-search>
				{assignmentCommand === null ? null : (
					<command-assignment role="status">
						<strong>Assign {assignmentCommand.displayName}</strong>
						<span>Press a hotbar key</span>
						<hotbar-key-list aria-hidden="true">
							{HOTBAR_KEYS.map((key) => (
								<kbd key={key}>{key}</kbd>
							))}
						</hotbar-key-list>
					</command-assignment>
				)}
				<command-results
					id="command-palette-results"
					role="listbox"
					aria-hidden={assignmentCommand === null ? undefined : "true"}
				>
					{filteredCommands.length === 0 ? (
						<command-empty>No matching commands</command-empty>
					) : (
						filteredCommands.map((command) => (
							<button
								key={command.id}
								id={`command-${command.id}`}
								type="button"
								role="option"
								aria-selected={command.id === activeCommand?.id}
								aria-checked={command.checked}
								aria-disabled={command.disabled}
								draggable
								onMouseEnter={() => setActiveId(command.id)}
								onDragStart={(event) => {
									if (event.dataTransfer === null) return
									event.dataTransfer.effectAllowed = "copy"
									event.dataTransfer.setData(HOTBAR_COMMAND_MIME, command.id)
								}}
								onClick={() => execute(command)}
							>
								<command-icon aria-hidden="true">
									<EditorIcon name={command.icon} />
								</command-icon>
								<command-name>
									<span>{command.displayName}</span>
									<small>{command.category}</small>
								</command-name>
								{command.disabled ? (
									<small>{command.disabledReason ?? "Unavailable"}</small>
								) : command.status !== undefined ? (
									<small>{command.status}</small>
								) : command.shortcut === undefined ? null : (
									<kbd>{command.shortcut}</kbd>
								)}
							</button>
						))
					)}
				</command-results>
				<command-hint>
					<span>
						<svg.Enter aria-hidden="true" />
						{MOD_KEY_LABEL}+Enter Assign
					</span>
					<span>
						<svg.ArrowUp aria-hidden="true" />
						<svg.ArrowDown aria-hidden="true" />
						Navigate
					</span>
					<span>
						<svg.Enter aria-hidden="true" />
						Run command
					</span>
				</command-hint>
			</command-palette-dialog>
		</command-palette>
	)
}
