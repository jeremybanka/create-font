import type { EditorAxisSource, GlyphId } from "@create-font/states"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { contoursToPath, resolveVariableGlyph } from "./geometry.ts"
import { createGlyphPreview } from "./glyph-preview.ts"
import {
	estimateNoiseCharacterCount,
	generateGlyphNoise,
	PREVIEW_SAMPLES,
	previewColorDefault,
	type PreviewSampleId,
} from "./preview-tile.ts"
import { useO } from "./state-hooks.ts"
import css from "./PreviewTile.module.css"

export interface PreviewTileProps {
	readonly workspace: EditorWorkspace
	readonly tileId: string
}

type PreviewGlyph = Readonly<{
	advance: number
	fillPath: string
	openPath: string
}>

const DEFAULT_TEXT = "Hamburgefontsiv"

export function PreviewTile({ workspace, tileId }: PreviewTileProps) {
	useO(workspace.font.atoms.documentRevision)
	const source = workspace.font.read.editorSource() ?? workspace.document
	const axes = source.axes as readonly EditorAxisSource[]
	const [text, setText] = useState(DEFAULT_TEXT)
	const [sample, setSample] = useState<PreviewSampleId>("custom")
	const [noiseSeed, setNoiseSeed] = useState("can")
	const [fontSize, setFontSize] = useState(42)
	const [lineHeight, setLineHeight] = useState(1.15)
	const [proofSize, setProofSize] = useState({ width: 0, height: 0 })
	const proofRef = useRef<HTMLElement>(null)
	const [coordinates, setCoordinates] = useState<
		Readonly<Record<string, number>>
	>(() => Object.fromEntries(axes.map((axis) => [axis.id, axis.default])))
	const [colors, setColors] = useState<"dark" | "light">(() =>
		previewColorDefault(
			typeof window !== "undefined" &&
				typeof window.matchMedia === "function" &&
				window.matchMedia("(prefers-color-scheme: light)").matches,
		),
	)
	const glyphs = useMemo(() => {
		const byCodePoint = new Map(
			source.cmap.map((entry) => [entry.codePoint, entry.glyphId] as const),
		)
		const fallback =
			source.glyphs.find((glyph) => glyph.name === ".notdef") ??
			source.glyphs.find((glyph) => glyph.export)
		const previews = new Map<GlyphId, PreviewGlyph>()
		for (const glyph of source.glyphs) {
			const compiled = workspace.font.silo.getState(
				workspace.font.selectors.glyphSource,
				glyph.id,
			)
			const resolved = compiled.ok
				? resolveVariableGlyph(glyph.id, compiled.value, axes, coordinates)
				: null
			const authoring = createGlyphPreview(
				glyph,
				source.defaultMasterId,
				source.metrics,
				source.metadata.unitsPerEm,
			)
			previews.set(glyph.id, {
				advance: resolved?.advanceWidth ?? authoring?.advanceWidth ?? 0,
				fillPath:
					resolved === null
						? (authoring?.path ?? "")
						: contoursToPath(resolved.contours),
				openPath: authoring?.openPath ?? "",
			})
		}
		return { byCodePoint, fallbackId: fallback?.id, previews }
	}, [axes, coordinates, source, workspace])
	const unitsPerEm = source.metadata.unitsPerEm
	const lineBoxTop = -source.metrics.ascender
	const lineBoxHeight = source.metrics.ascender - source.metrics.descender
	const noiseLength = estimateNoiseCharacterCount({
		...proofSize,
		fontSize,
		lineHeight,
	})

	useEffect(() => {
		const element = proofRef.current
		if (element === null) return
		const publish = (width: number, height: number): void =>
			setProofSize((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			)
		publish(element.clientWidth, element.clientHeight)
		if (typeof ResizeObserver !== "function") return
		const observer = new ResizeObserver(([entry]) => {
			if (entry !== undefined)
				publish(entry.contentRect.width, entry.contentRect.height)
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		if (sample !== "noise") return
		const generated = generateGlyphNoise(noiseSeed, noiseLength)
		setText((current) => (current === generated ? current : generated))
	}, [noiseLength, noiseSeed, sample])

	const chooseSample = (next: PreviewSampleId): void => {
		setSample(next)
		if (next === "custom") return
		setText(
			next === "noise"
				? generateGlyphNoise(noiseSeed, noiseLength)
				: PREVIEW_SAMPLES[next],
		)
	}

	return (
		<preview-tile
			className={css.class}
			data-colors={colors}
			data-tile-id={tileId}
		>
			<preview-options aria-label="Preview options">
				<label data-wide>
					<span>Sample</span>
					<select
						aria-label="Preview sample"
						value={sample}
						onChange={(event) =>
							chooseSample(event.currentTarget.value as PreviewSampleId)
						}
					>
						<option value="custom">Custom text</option>
						<option value="noise">Glyph noise</option>
						<option value="lorem">Lorem ipsum</option>
						<option value="cicero">Cicero translation</option>
						<option value="pi">1,000 digits of pi</option>
						<option value="nato">NATO alphabet</option>
					</select>
				</label>
				{sample === "noise" ? (
					<label data-wide>
						<span>Glyphs</span>
						<input
							aria-label="Noise glyphs"
							value={noiseSeed}
							onInput={(event) => {
								setNoiseSeed(event.currentTarget.value)
							}}
						/>
					</label>
				) : null}
				<label>
					<span>Size</span>
					<input
						type="number"
						aria-label="Font size"
						min="8"
						max="240"
						value={fontSize}
						onInput={(event) => setFontSize(Number(event.currentTarget.value))}
					/>
				</label>
				<label>
					<span>Leading</span>
					<input
						type="number"
						aria-label="Line height"
						min="0.5"
						max="3"
						step="0.05"
						value={lineHeight}
						onInput={(event) =>
							setLineHeight(Number(event.currentTarget.value))
						}
					/>
				</label>
				{axes
					.filter((axis) => !axis.hidden)
					.map((axis) => (
						<label data-wide key={axis.id}>
							<span>{axis.tag}</span>
							<input
								type="range"
								aria-label={`${axis.name} (${axis.tag})`}
								min={axis.min}
								max={axis.max}
								step="1"
								value={coordinates[axis.id] ?? axis.default}
								onInput={(event) =>
									setCoordinates((current) => ({
										...current,
										[axis.id]: Number(event.currentTarget.value),
									}))
								}
							/>
							<output>{coordinates[axis.id] ?? axis.default}</output>
						</label>
					))}
				<fieldset data-wide>
					<legend>Colors</legend>
					<button
						type="button"
						aria-pressed={colors === "dark"}
						onClick={() => setColors("dark")}
					>
						White on black
					</button>
					<button
						type="button"
						aria-pressed={colors === "light"}
						onClick={() => setColors("light")}
					>
						Black on white
					</button>
				</fieldset>
				<label data-wide>
					<span>Text</span>
					<textarea
						aria-label="Preview text"
						rows={2}
						value={text}
						onInput={(event) => {
							setSample("custom")
							setText(event.currentTarget.value)
						}}
					/>
				</label>
			</preview-options>
			<preview-scroll
				ref={proofRef}
				tabIndex={0}
				aria-label="Rendered preview"
				style={{ fontSize: `${fontSize}px`, lineHeight }}
			>
				{Array.from(text).map((character, index) => {
					if (character === "\n") return <br key={`break:${index}`} />
					const glyphId =
						glyphs.byCodePoint.get(character.codePointAt(0) ?? -1) ??
						glyphs.fallbackId
					const glyph =
						glyphId === undefined ? undefined : glyphs.previews.get(glyphId)
					if (glyph === undefined) return null
					return (
						<svg
							key={`${index}:${character}`}
							aria-hidden="true"
							viewBox={`0 ${lineBoxTop} ${Math.max(glyph.advance, 1)} ${lineBoxHeight}`}
							style={{ width: `${(glyph.advance / unitsPerEm).toFixed(4)}em` }}
						>
							<g transform="scale(1 -1)">
								<path d={glyph.fillPath} />
								<path data-open d={glyph.openPath} />
							</g>
						</svg>
					)
				})}
			</preview-scroll>
		</preview-tile>
	)
}
