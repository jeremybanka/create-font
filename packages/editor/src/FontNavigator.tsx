import {
	autoUpdate,
	computePosition,
	flip,
	offset,
	shift,
} from "@floating-ui/dom"
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

import { IS_MAC_LIKE, MOD_KEY_LABEL } from "./editor-tools-and-hotkeys.ts"
import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./FontNavigator.module.css"
import { useO } from "./state-hooks.ts"

export interface FontNavigatorProps {
	readonly workspace: EditorWorkspace
}

export function FontNavigator({ workspace }: FontNavigatorProps) {
	const source =
		useO(workspace.font.selectors.editorSource) ?? workspace.document
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const location = useO(workspace.ui.previewLocation)
	const [addingGlyphs, setAddingGlyphs] = useState(false)
	const [glyphNames, setGlyphNames] = useState("")
	const [floatingStyle, setFloatingStyle] = useState<JSX.CSSProperties>({
		position: "fixed",
	})
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const dialogRef = useRef<HTMLElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const openAddGlyphs = (): void => {
		setGlyphNames("")
		setAddingGlyphs(true)
	}
	const closeAddGlyphs = (): void => {
		setAddingGlyphs(false)
		requestAnimationFrame(() => addButtonRef.current?.focus())
	}

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			const mod = IS_MAC_LIKE ? event.metaKey : event.ctrlKey
			if (
				mod &&
				event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === "n"
			) {
				event.preventDefault()
				openAddGlyphs()
				return
			}
			if (addingGlyphs && event.key === "Escape") {
				event.preventDefault()
				closeAddGlyphs()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [addingGlyphs])

	useEffect(() => {
		if (!addingGlyphs) return
		const frame = requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		})
		return () => cancelAnimationFrame(frame)
	}, [addingGlyphs])

	useEffect(() => {
		if (!addingGlyphs) return
		const reference = addButtonRef.current
		const floating = dialogRef.current
		if (reference === null || floating === null) return
		return autoUpdate(reference, floating, () => {
			void computePosition(reference, floating, {
				placement: "right-end",
				strategy: "fixed",
				middleware: [offset(10), flip(), shift({ padding: 12 })],
			}).then(({ x, y }) => {
				setFloatingStyle({ position: "fixed", left: x, top: y })
			})
		})
	}, [addingGlyphs])

	return (
		<font-navigator className={css.class}>
			<nav aria-label="Font navigation">
				<navigation-section>
					<section-heading>
						<span>Masters</span>
						<data value={source.masters.length}>{source.masters.length}</data>
					</section-heading>
					<ul>
						{source.masters.map((master) => (
							<li key={master.id}>
								<button
									type="button"
									aria-pressed={master.id === activeMasterId}
									onClick={() => workspace.actions.selectMaster(master.id)}
								>
									<master-swatch data-master={master.kind} />
									<span>{master.name}</span>
									<small>
										{master.kind === "default" ? "Default" : "Source"}
									</small>
								</button>
							</li>
						))}
					</ul>
				</navigation-section>

				<navigation-section>
					<section-heading>
						<span>Instances</span>
						<data value={source.instances.length}>
							{source.instances.length}
						</data>
					</section-heading>
					<ul>
						{source.instances.map((instance) => {
							const isActive = source.axes.every(
								(axis) =>
									(instance.coordinates[axis.id] ?? axis.default) ===
									(location[axis.id] ?? axis.default),
							)
							const locationLabel = source.axes
								.map((axis) => instance.coordinates[axis.id] ?? axis.default)
								.join("/")
							return (
								<li key={instance.id}>
									<button
										type="button"
										aria-pressed={isActive}
										onClick={() =>
											workspace.actions.selectInstance(instance.id)
										}
									>
										<instance-mark />
										<span>{instance.name}</span>
										<small>{locationLabel}</small>
									</button>
								</li>
							)
						})}
					</ul>
				</navigation-section>

				<navigation-section data-grow="true">
					<section-heading>
						<span>Glyphs</span>
						<data value={source.glyphs.length}>{source.glyphs.length}</data>
					</section-heading>
					<glyph-grid>
						{source.glyphs.map((glyph) => (
							<button
								key={glyph.id}
								type="button"
								aria-pressed={glyph.id === activeGlyphId}
								aria-label={`Edit ${glyph.name}`}
								onClick={() => workspace.actions.selectGlyph(glyph.id)}
							>
								<glyph-tile aria-hidden="true">
									{glyph.name === ".notdef" ? "◌" : glyph.name}
								</glyph-tile>
								<span>{glyph.name}</span>
							</button>
						))}
					</glyph-grid>
					<add-glyphs-control>
						<button
							ref={addButtonRef}
							type="button"
							aria-label="Add glyphs"
							aria-keyshortcuts="Meta+Shift+N Control+Shift+N"
							aria-expanded={addingGlyphs}
							onClick={openAddGlyphs}
						>
							<add-glyph-icon aria-hidden="true">+</add-glyph-icon>
							<span>Add</span>
						</button>
					</add-glyphs-control>
				</navigation-section>
			</nav>
			{addingGlyphs ? (
				<add-glyph-dialog
					ref={dialogRef}
					role="dialog"
					aria-modal="true"
					aria-labelledby="add-glyphs-heading"
					style={floatingStyle}
				>
					<dialog-heading>
						<strong id="add-glyphs-heading">Add glyphs</strong>
						<button
							type="button"
							aria-label="Cancel adding glyphs"
							onClick={closeAddGlyphs}
						>
							×
						</button>
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
							onKeyDown={(event) => {
								if (event.key !== "Enter") return
								event.preventDefault()
								event.currentTarget.form?.requestSubmit()
							}}
						/>
						<small>Separate names with spaces · {MOD_KEY_LABEL}+Shift+N</small>
						<button type="submit">Add glyphs</button>
					</form>
				</add-glyph-dialog>
			) : null}
		</font-navigator>
	)
}
