import {
	ArrowDownIcon,
	ArrowUpIcon,
	EnterIcon,
	MagnifyingGlassIcon,
} from "@radix-ui/react-icons"
import type * as React from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import {
	filterPaletteCommands,
	nextCommandId,
	type PaletteCommand,
} from "./command-palette.ts"
import {
	HOTBAR_COMMAND_MIME,
	HOTBAR_KEYS,
	hotbarSlotIndexForKeyboardEvent,
} from "./command-assignment.ts"
import css from "./CommandPalette.module.css"
import { scrollActiveDescendantIntoView } from "./active-descendant-scroll.ts"
import { EditorIcon } from "./EditorIcon.tsx"
import { IS_MAC_LIKE, MOD_KEY_LABEL } from "./platform.ts"

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
	const resultsRef = useRef<HTMLElement>(null)
	const [scrollRequest, setScrollRequest] = useState<{
		readonly id: string
		readonly sequence: number
	} | null>(null)
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

	useLayoutEffect(() => {
		if (scrollRequest === null) return
		scrollActiveDescendantIntoView(
			resultsRef.current,
			document.getElementById(`command-${scrollRequest.id}`),
		)
	}, [scrollRequest])

	const updateQuery = (value: string): void => {
		const matches = filterPaletteCommands(commands, value)
		setQuery(value)
		const nextId = nextCommandId(matches, null, 1)
		setActiveId(nextId)
		if (resultsRef.current !== null) resultsRef.current.scrollTop = 0
		if (nextId !== null)
			setScrollRequest((request) => ({
				id: nextId,
				sequence: (request?.sequence ?? 0) + 1,
			}))
	}
	const execute = (command: PaletteCommand | undefined): void => {
		if (command === undefined || command.disabled) return
		onExecute(command)
	}
	const handleKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>,
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
			const nextId = nextCommandId(
				filteredCommands,
				activeId,
				event.key === "ArrowDown" ? 1 : -1,
			)
			setActiveId(nextId)
			if (nextId !== null)
				setScrollRequest((request) => ({
					id: nextId,
					sequence: (request?.sequence ?? 0) + 1,
				}))
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
			onMouseDown={(event: React.MouseEvent<HTMLElement>) => {
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
						autoComplete="off"
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
					ref={resultsRef}
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
