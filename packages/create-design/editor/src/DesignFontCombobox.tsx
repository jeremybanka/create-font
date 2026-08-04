import { useEffect, useId, useMemo, useState } from "react"
import type { KeyboardEvent } from "react"

import type { DesignFontReference } from "@create-design/source"
import css from "./DesignFontCombobox.module.css"

export interface DesignFontComboboxProps {
	readonly disabled?: boolean
	readonly fonts: readonly DesignFontReference[]
	readonly label: string
	readonly onSelect: (fontId: string) => void
	readonly selectedFontId: string | null
}

function matchingFonts(
	fonts: readonly DesignFontReference[],
	query: string,
): readonly DesignFontReference[] {
	const normalized = query.trim().toLocaleLowerCase()
	return normalized.length === 0
		? fonts
		: fonts.filter(({ family }) =>
				family.toLocaleLowerCase().includes(normalized),
			)
}

export function DesignFontCombobox({
	disabled = false,
	fonts,
	label,
	onSelect,
	selectedFontId,
}: DesignFontComboboxProps) {
	const listboxId = useId()
	const selectedFont =
		fonts.find(({ id }) => id === selectedFontId) ?? fonts[0] ?? null
	const [query, setQuery] = useState(selectedFont?.family ?? "")
	const [open, setOpen] = useState(false)
	const filtered = useMemo(() => matchingFonts(fonts, query), [fonts, query])
	const [activeFontId, setActiveFontId] = useState<string | null>(
		selectedFont?.id ?? null,
	)

	useEffect(() => {
		if (open) return
		setQuery(selectedFont?.family ?? "")
		setActiveFontId(selectedFont?.id ?? null)
	}, [open, selectedFont?.family, selectedFont?.id])

	useEffect(() => {
		if (filtered.some(({ id }) => id === activeFontId)) return
		setActiveFontId(filtered[0]?.id ?? null)
	}, [activeFontId, filtered])

	const choose = (font: DesignFontReference): void => {
		onSelect(font.id)
		setQuery(font.family)
		setActiveFontId(font.id)
		setOpen(false)
	}
	const move = (direction: -1 | 1): void => {
		if (filtered.length === 0) return
		const current = filtered.findIndex(({ id }) => id === activeFontId)
		const index =
			current < 0
				? direction > 0
					? 0
					: filtered.length - 1
				: (current + direction + filtered.length) % filtered.length
		setActiveFontId(filtered[index]?.id ?? null)
	}
	const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (disabled) return
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			setOpen(true)
			move(event.key === "ArrowDown" ? 1 : -1)
			return
		}
		if (event.key === "Enter" && open) {
			const font = filtered.find(({ id }) => id === activeFontId)
			if (font !== undefined) {
				event.preventDefault()
				choose(font)
			}
			return
		}
		if (event.key === "Escape" && open) {
			event.preventDefault()
			setQuery(selectedFont?.family ?? "")
			setOpen(false)
		}
	}

	return (
		<design-font-combobox
			className={css.class}
			data-disabled={disabled || undefined}
			onBlur={(event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return
				setQuery(selectedFont?.family ?? "")
				setOpen(false)
			}}
		>
			<input
				type="text"
				role="combobox"
				aria-label={label}
				aria-autocomplete="list"
				aria-controls={listboxId}
				aria-expanded={!disabled && open}
				aria-activedescendant={
					!open || activeFontId === null
						? undefined
						: `${listboxId}-${encodeURIComponent(activeFontId)}`
				}
				autoComplete="off"
				disabled={disabled}
				placeholder={
					disabled ? "No workspace fonts available" : "Find a workspace font"
				}
				value={query}
				onFocus={() => setOpen(true)}
				onChange={(event) => {
					setQuery(event.currentTarget.value)
					setOpen(true)
				}}
				onKeyDown={keyDown}
			/>
			<font-option-list
				id={listboxId}
				role="listbox"
				hidden={disabled || !open}
			>
				{filtered.length === 0 ? (
					<p role="status">No loaded fonts match “{query}”.</p>
				) : (
					filtered.map((font) => (
						<button
							key={font.id}
							id={`${listboxId}-${encodeURIComponent(font.id)}`}
							type="button"
							role="option"
							aria-selected={font.id === selectedFont?.id}
							data-active={font.id === activeFontId || undefined}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => choose(font)}
						>
							<strong>{font.family}</strong>
							<small>{font.id}</small>
						</button>
					))
				)}
			</font-option-list>
		</design-font-combobox>
	)
}
