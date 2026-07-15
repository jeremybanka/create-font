import type { EditorIconName } from "./EditorIcon.tsx"

export interface PaletteCommand {
	readonly id: string
	readonly displayName: string
	readonly category: string
	readonly icon: EditorIconName
	readonly keywords?: readonly string[]
	readonly shortcut?: string
	readonly disabled?: boolean
	readonly do: () => void
}

export interface CommandPaletteKeyboardEvent {
	readonly key: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
	readonly altKey: boolean
}

export function isCommandPaletteKeyboardEvent(
	event: CommandPaletteKeyboardEvent,
	macLike: boolean,
): boolean {
	return (
		event.key.toLowerCase() === "p" &&
		(macLike ? event.metaKey : event.ctrlKey) &&
		!(macLike ? event.ctrlKey : event.metaKey) &&
		event.shiftKey &&
		!event.altKey
	)
}

function fuzzyScore(needle: string, haystack: string): number | null {
	let score = 0
	let previousIndex = -1
	for (const character of needle) {
		const index = haystack.indexOf(character, previousIndex + 1)
		if (index === -1) return null
		const gap = index - previousIndex - 1
		score += gap
		if (index === 0 || haystack[index - 1] === " ") score -= 2
		previousIndex = index
	}
	return score
}

export function filterPaletteCommands(
	commands: readonly PaletteCommand[],
	query: string,
): readonly PaletteCommand[] {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (tokens.length === 0) return commands

	return commands
		.map((command, index) => {
			const searchable = [
				command.displayName,
				command.category,
				...(command.keywords ?? []),
			]
				.join(" ")
				.toLowerCase()
			let score = 0
			for (const token of tokens) {
				const tokenScore = fuzzyScore(token, searchable)
				if (tokenScore === null) return null
				score += tokenScore
			}
			return { command, index, score }
		})
		.filter((result): result is NonNullable<typeof result> => result !== null)
		.sort((left, right) => left.score - right.score || left.index - right.index)
		.map(({ command }) => command)
}

export function nextEnabledCommandId(
	commands: readonly PaletteCommand[],
	activeId: string | null,
	delta: -1 | 1,
): string | null {
	const enabled = commands.filter((command) => !command.disabled)
	if (enabled.length === 0) return null
	const currentIndex = enabled.findIndex((command) => command.id === activeId)
	const nextIndex =
		currentIndex === -1
			? delta === 1
				? 0
				: enabled.length - 1
			: (currentIndex + delta + enabled.length) % enabled.length
	return enabled[nextIndex]?.id ?? null
}
