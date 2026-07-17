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
	nextEnabledCommandId,
	type PaletteCommand,
} from "./command-palette.ts"
import css from "./CommandPalette.module.css"
import { EditorIcon } from "./EditorIcon.tsx"

export interface CommandPaletteProps {
	readonly commands: readonly PaletteCommand[]
	readonly onCancel: () => void
	readonly onExecute: (command: PaletteCommand) => void
}

export function CommandPalette({
	commands,
	onCancel,
	onExecute,
}: CommandPaletteProps) {
	const [query, setQuery] = useState("")
	const [activeId, setActiveId] = useState<string | null>(
		nextEnabledCommandId(commands, null, 1),
	)
	const inputRef = useRef<HTMLInputElement>(null)
	const filteredCommands = filterPaletteCommands(commands, query)
	const activeCommand = filteredCommands.find(
		(command) => command.id === activeId && !command.disabled,
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
		setActiveId(nextEnabledCommandId(matches, null, 1))
	}
	const execute = (command: PaletteCommand | undefined): void => {
		if (command === undefined || command.disabled) return
		onExecute(command)
	}
	const handleKeyDown = (
		event: JSX.TargetedKeyboardEvent<HTMLInputElement>,
	): void => {
		if (event.key === "Escape") {
			event.preventDefault()
			onCancel()
			return
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			setActiveId(
				nextEnabledCommandId(
					filteredCommands,
					activeId,
					event.key === "ArrowDown" ? 1 : -1,
				),
			)
			return
		}
		if (event.key === "Enter") {
			event.preventDefault()
			execute(activeCommand)
		}
	}

	return (
		<command-palette
			className={css.class}
			onMouseDown={(event: JSX.TargetedMouseEvent<HTMLElement>) => {
				if (event.target === event.currentTarget) onCancel()
			}}
		>
			<command-palette-dialog
				role="dialog"
				aria-modal="true"
				aria-label="Command Palette"
			>
				<command-search>
					<MagnifyingGlassIcon aria-hidden="true" />
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
				<command-results id="command-palette-results" role="listbox">
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
								disabled={command.disabled}
								onMouseEnter={() => {
									if (!command.disabled) setActiveId(command.id)
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
						<ArrowUpIcon aria-hidden="true" />
						<ArrowDownIcon aria-hidden="true" />
						Navigate
					</span>
					<span>
						<EnterIcon aria-hidden="true" />
						Run command
					</span>
				</command-hint>
			</command-palette-dialog>
		</command-palette>
	)
}
