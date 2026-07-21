import {
	Cross1Icon,
	MagnifyingGlassIcon,
	PlusIcon,
} from "@radix-ui/react-icons"
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./GlyphLibrary.module.css"
import { createGlyphPreview } from "./glyph-preview.ts"
import { useO, useOF } from "./state-hooks.ts"
import { TooltipButton } from "./TooltipButton.tsx"
import {
	glyphDifference,
	type EditorVersionControl,
} from "./version-control.ts"

export interface GlyphLibraryProps {
	readonly addingGlyphs: boolean
	readonly onAddingGlyphsChange: (addingGlyphs: boolean) => void
	readonly workspace: EditorWorkspace
	readonly versionControl?: EditorVersionControl
}

export function GlyphLibrary({
	addingGlyphs,
	onAddingGlyphsChange,
	workspace,
	versionControl,
}: GlyphLibraryProps) {
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const glyphIndex = useO(workspace.ui.glyphIndex)
	const [query, setQuery] = useState("")
	const [glyphNames, setGlyphNames] = useState("")
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const filteredGlyphs = glyphIndex.filter((glyph) =>
		glyph.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	)
	const closeAddGlyphs = (): void => {
		onAddingGlyphsChange(false)
		requestAnimationFrame(() => addButtonRef.current?.focus())
	}

	useEffect(() => {
		if (!addingGlyphs) return
		setGlyphNames("")
		const frame = requestAnimationFrame(() => inputRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [addingGlyphs])

	useEffect(() => {
		if (!addingGlyphs) return
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return
			event.preventDefault()
			closeAddGlyphs()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [addingGlyphs])

	return (
		<glyph-library className={css.class}>
			<library-heading>
				<view-title>
					<p>Font source</p>
					<h1>Glyphs</h1>
					<span>
						{glyphIndex.length} glyph
						{glyphIndex.length === 1 ? "" : "s"}
					</span>
				</view-title>
				<library-actions>
					<label>
						<MagnifyingGlassIcon aria-hidden="true" />
						<span className="sr-only">Search glyphs</span>
						<input
							type="search"
							value={query}
							placeholder="Search glyphs"
							onInput={(event) => setQuery(event.currentTarget.value)}
						/>
					</label>
					<button
						ref={addButtonRef}
						type="button"
						aria-expanded={addingGlyphs}
						onClick={() => onAddingGlyphsChange(true)}
					>
						<PlusIcon aria-hidden="true" />
						Add glyphs
					</button>
				</library-actions>
			</library-heading>

			{filteredGlyphs.length === 0 ? (
				<empty-library>
					<strong>No glyphs match “{query}”.</strong>
					<span>Try another name or clear the search.</span>
				</empty-library>
			) : (
				<glyph-grid aria-label="Glyph library">
					{filteredGlyphs.map((glyph) => (
						<GlyphLibraryItem
							key={glyph.id}
							workspace={workspace}
							glyphId={glyph.id}
							activeGlyphId={activeGlyphId}
							activeMasterId={activeMasterId}
							{...(versionControl === undefined ? {} : { versionControl })}
						/>
					))}
				</glyph-grid>
			)}

			{addingGlyphs ? (
				<dialog-backdrop
					role="presentation"
					onMouseDown={(event: JSX.TargetedMouseEvent<HTMLElement>) => {
						if (event.target === event.currentTarget) closeAddGlyphs()
					}}
				>
					<add-glyph-dialog
						role="dialog"
						aria-modal="true"
						aria-labelledby="add-glyphs-heading"
					>
						<dialog-heading>
							<strong id="add-glyphs-heading">Add glyphs</strong>
							<TooltipButton
								label="Cancel adding glyphs"
								description="Close this dialog without adding glyphs."
								placement="left"
								onClick={closeAddGlyphs}
							>
								<Cross1Icon aria-hidden="true" />
							</TooltipButton>
						</dialog-heading>
						<form
							onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
								event.preventDefault()
								const names = glyphNames.trim().split(/\s+/).filter(Boolean)
								if (names.length === 0) return
								workspace.actions.addGlyphs(names)
								closeAddGlyphs()
							}}
						>
							<label for="new-glyph-names">Glyph names</label>
							<input
								ref={inputRef}
								id="new-glyph-names"
								value={glyphNames}
								placeholder="B C Aacute"
								autocomplete="off"
								onInput={(event) => setGlyphNames(event.currentTarget.value)}
							/>
							<small>Separate glyph names with spaces.</small>
							<button type="submit">Add glyphs</button>
						</form>
					</add-glyph-dialog>
				</dialog-backdrop>
			) : null}
		</glyph-library>
	)
}

function GlyphLibraryItem({
	workspace,
	glyphId,
	activeGlyphId,
	activeMasterId,
	versionControl,
}: {
	readonly workspace: EditorWorkspace
	readonly glyphId: Parameters<EditorWorkspace["actions"]["selectGlyph"]>[0]
	readonly activeGlyphId:
		| Parameters<EditorWorkspace["actions"]["selectGlyph"]>[0]
		| null
	readonly activeMasterId: Parameters<
		EditorWorkspace["actions"]["selectMaster"]
	>[0]
	readonly versionControl?: EditorVersionControl
}) {
	const difference = glyphDifference(versionControl?.comparison, glyphId)
	const glyph = useOF(workspace.font.selectors.editorGlyphSource, glyphId)
	const metrics =
		useO(workspace.font.atoms.metrics) ?? workspace.document.metrics
	const metadata =
		useO(workspace.font.atoms.metadata) ?? workspace.document.metadata
	const preview =
		glyph === null
			? null
			: createGlyphPreview(glyph, activeMasterId, metrics, metadata.unitsPerEm)
	return (
		<glyph-library-item>
			{glyph === null ? null : (
				<button
					type="button"
					aria-pressed={glyph.id === activeGlyphId}
					aria-label={`Open ${glyph.name} in the canvas`}
					data-difference={difference}
					onClick={() => {
						workspace.actions.selectGlyph(glyph.id)
						workspace.actions.navigate("/")
					}}
				>
					<glyph-tile aria-hidden="true">
						{preview === null ? null : (
							<svg
								viewBox={preview.viewBox}
								preserveAspectRatio="xMidYMid meet"
								focusable="false"
							>
								<path
									d={preview.path}
									fillRule="nonzero"
									clipRule="nonzero"
									transform="scale(1 -1)"
								/>
								<path
									data-open-contour=""
									d={preview.openPath}
									fill="none"
									stroke="currentColor"
									strokeWidth="1.25"
									vectorEffect="non-scaling-stroke"
									transform="scale(1 -1)"
								/>
							</svg>
						)}
					</glyph-tile>
					<glyph-label>
						<strong>{glyph.name}</strong>
						<span>{glyph.export ? "Exported" : "Not exported"}</span>
						{difference === "unchanged" ? null : <small>{difference}</small>}
					</glyph-label>
				</button>
			)}
		</glyph-library-item>
	)
}
