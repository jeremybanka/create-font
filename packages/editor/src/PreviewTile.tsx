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

type ProofGlyph = Readonly<{
	character: string
	glyphId: GlyphId
	x: number
	y: number
}>

const DEFAULT_TEXT = "Hamburgefontsiv"
let previewInstance = 0

export function PreviewTile({ workspace, tileId }: PreviewTileProps) {
	useO(workspace.font.atoms.documentRevision)
	const source = workspace.font.read.editorSource() ?? workspace.document
	const axes = source.axes as readonly EditorAxisSource[]
	const [text, setText] = useState(DEFAULT_TEXT)
	const [sample, setSample] = useState<PreviewSampleId>("custom")
	const [noiseSeed, setNoiseSeed] = useState("can")
	const [renderedNoiseSeed, setRenderedNoiseSeed] = useState("can")
	const [fontSize, setFontSize] = useState(42)
	const [lineHeight, setLineHeight] = useState(1.15)
	const [proofSize, setProofSize] = useState({ width: 0, height: 0 })
	const proofRef = useRef<HTMLElement>(null)
	const proofId = useRef(`preview-proof-${++previewInstance}`).current
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
	const noiseLength = estimateNoiseCharacterCount({
		...proofSize,
		fontSize,
		lineHeight,
	})

	useEffect(() => {
		const timeout = window.setTimeout(
			() => setRenderedNoiseSeed(noiseSeed),
			120,
		)
		return () => window.clearTimeout(timeout)
	}, [noiseSeed])

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

	const proofText =
		sample === "noise"
			? generateGlyphNoise(renderedNoiseSeed, noiseLength)
			: text
	const proofLayout = useMemo(() => {
		const lineAdvance = unitsPerEm * lineHeight
		const width = Math.max(
			unitsPerEm,
			((proofSize.width || fontSize * 8) / fontSize) * unitsPerEm,
		)
		const placements: ProofGlyph[] = []
		let x = 0
		let line = 0
		for (const character of proofText) {
			if (character === "\n") {
				x = 0
				line++
				continue
			}
			const glyphId =
				glyphs.byCodePoint.get(character.codePointAt(0) ?? -1) ??
				glyphs.fallbackId
			if (glyphId === undefined) continue
			const glyph = glyphs.previews.get(glyphId)
			if (glyph === undefined) continue
			const advance = Math.max(glyph.advance, 1)
			if (x > 0 && x + advance > width) {
				x = 0
				line++
			}
			placements.push({
				character,
				glyphId,
				x,
				y: source.metrics.ascender + line * lineAdvance,
			})
			x += advance
		}
		const usedGlyphIds = [...new Set(placements.map(({ glyphId }) => glyphId))]
		return {
			definitionIndex: new Map(
				usedGlyphIds.map((glyphId, index) => [glyphId, index] as const),
			),
			height: Math.max(lineAdvance, (line + 1) * lineAdvance),
			placements,
			usedGlyphIds,
			width,
		}
	}, [
		fontSize,
		glyphs,
		lineHeight,
		proofSize.width,
		proofText,
		source.metrics.ascender,
		unitsPerEm,
	])

	const chooseSample = (next: PreviewSampleId): void => {
		setSample(next)
		if (next !== "custom" && next !== "noise") setText(PREVIEW_SAMPLES[next])
	}

	return (
		<preview-tile className={css.class} data-tile-id={tileId}>
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
						type="range"
						aria-label="Font size"
						min="4"
						max="72"
						step="1"
						value={fontSize}
						onInput={(event) => setFontSize(Number(event.currentTarget.value))}
					/>
					<output>{fontSize}px</output>
				</label>
				<label>
					<span>Leading</span>
					<input
						type="range"
						aria-label="Line height"
						min="0.5"
						max="2.5"
						step="0.05"
						value={lineHeight}
						onInput={(event) =>
							setLineHeight(Number(event.currentTarget.value))
						}
					/>
					<output>{lineHeight}</output>
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
				<label data-wide>
					<span>Colors</span>
					<select
						aria-label="Preview colors"
						value={colors}
						onChange={(event) =>
							setColors(event.currentTarget.value as "dark" | "light")
						}
					>
						<option value="dark">White on black</option>
						<option value="light">Black on white</option>
					</select>
				</label>
				{sample === "noise" ? null : (
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
				)}
			</preview-options>
			<preview-scroll
				ref={proofRef}
				tabIndex={0}
				aria-label="Rendered preview"
				data-colors={colors}
				style={{ fontSize: `${fontSize}px`, lineHeight }}
			>
				<svg
					aria-hidden="true"
					data-proof
					viewBox={`0 0 ${proofLayout.width} ${proofLayout.height}`}
					style={{
						height: `${(proofLayout.height / unitsPerEm) * fontSize}px`,
					}}
				>
					<defs>
						{proofLayout.usedGlyphIds.map((glyphId, index) => {
							const glyph = glyphs.previews.get(glyphId)
							return glyph === undefined ? null : (
								<g id={`${proofId}-${index}`} key={glyphId}>
									<path d={glyph.fillPath} />
									<path data-open d={glyph.openPath} />
								</g>
							)
						})}
					</defs>
					{proofLayout.placements.map((placement, index) => {
						const definitionIndex = proofLayout.definitionIndex.get(
							placement.glyphId,
						)
						return definitionIndex === undefined ? null : (
							<use
								key={index}
								data-character={placement.character}
								href={`#${proofId}-${definitionIndex}`}
								transform={`translate(${placement.x} ${placement.y}) scale(1 -1)`}
							/>
						)
					})}
				</svg>
			</preview-scroll>
		</preview-tile>
	)
}
