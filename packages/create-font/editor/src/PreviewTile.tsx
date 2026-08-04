import type { EditorAxisSource } from "@create-font/states"
import { useO } from "atom.io/react"
import { useEffect, useRef, useState } from "react"

import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	estimateNoiseCharacterCount,
	generateGlyphNoise,
	PREVIEW_SAMPLES,
	previewColorDefault,
	type PreviewSampleId,
} from "./preview-tile.ts"
import css from "./PreviewTile.module.css"

export interface PreviewTileProps {
	readonly workspace: EditorWorkspace
	readonly tileId: string
}

const DEFAULT_TEXT = "Hamburgefontsiv"

export function PreviewTile({ workspace, tileId }: PreviewTileProps) {
	const compilation = useO(workspace.liveFont.compilation)
	const activeFont = useO(workspace.liveFont.active)
	const axes = (useO(workspace.font.selectors.editorAxesSource) ??
		workspace.document.axes) as readonly EditorAxisSource[]
	const [text, setText] = useState(DEFAULT_TEXT)
	const [sample, setSample] = useState<PreviewSampleId>("custom")
	const [noiseSeed, setNoiseSeed] = useState("can")
	const [renderedNoiseSeed, setRenderedNoiseSeed] = useState("can")
	const [fontSize, setFontSize] = useState(42)
	const [lineHeight, setLineHeight] = useState(1.15)
	const [paintDuration, setPaintDuration] = useState<number | null>(null)
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
	const noiseLength = estimateNoiseCharacterCount({
		...proofSize,
		fontSize,
		lineHeight,
	})

	useEffect(() => workspace.liveFont.retain(), [workspace])

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

	useEffect(() => {
		if (
			activeFont.status !== "ready" ||
			typeof requestAnimationFrame !== "function"
		)
			return
		const started = performance.now()
		let secondFrame = 0
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				setPaintDuration(performance.now() - started)
			})
		})
		return () => {
			cancelAnimationFrame(firstFrame)
			if (secondFrame !== 0) cancelAnimationFrame(secondFrame)
		}
	}, [activeFont.generation, activeFont.status])

	const proofText =
		sample === "noise"
			? generateGlyphNoise(renderedNoiseSeed, noiseLength)
			: text
	const chooseSample = (next: PreviewSampleId): void => {
		setSample(next)
		if (next !== "custom" && next !== "noise") setText(PREVIEW_SAMPLES[next])
	}
	const fontVariationSettings = axes
		.map((axis) => `"${axis.tag}" ${coordinates[axis.id] ?? axis.default}`)
		.join(", ")
	const activeFamily =
		activeFont.status === "ready" || activeFont.family !== null
			? activeFont.family
			: null
	const diagnostic =
		compilation.status === "failed"
			? compilation.diagnostics[0]?.message
			: activeFont.status === "failed"
				? activeFont.diagnostic.message
				: undefined
	const degradedDiagnostic =
		compilation.status === "ready"
			? compilation.diagnostics[0]?.message
			: undefined
	const status =
		diagnostic ??
		degradedDiagnostic ??
		(compilation.status === "compiling" || activeFont.status === "loading"
			? activeFamily === null
				? "Compiling preview font…"
				: "Updating preview font…"
			: activeFamily === null
				? "Preview font pending"
				: `Live font · ${compilation.status === "ready" ? compilation.artifact.timings.total.toFixed(1) : "0.0"} ms`)

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
							onInput={(event) => setNoiseSeed(event.currentTarget.value)}
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
								onInput={(event) => {
									const value = Number(event.currentTarget.value)
									setCoordinates((current) => ({
										...current,
										[axis.id]: value,
									}))
								}}
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
				<output
					data-live-font-status
					data-error={diagnostic !== undefined}
					data-degraded={degradedDiagnostic !== undefined}
					aria-live="polite"
				>
					{status}
				</output>
			</preview-options>
			<preview-scroll
				ref={proofRef}
				tabIndex={0}
				aria-label="Rendered preview"
				data-colors={colors}
				data-live-font={activeFamily === null ? "pending" : "ready"}
				data-compilation-ms={
					compilation.status === "ready"
						? compilation.artifact.timings.total
						: undefined
				}
				data-projection-ingestion-ms={
					compilation.status === "ready"
						? compilation.artifact.timings.projectionAndIngestion
						: undefined
				}
				data-compilation-queue-ms={
					compilation.status === "ready"
						? compilation.artifact.timings.queueing
						: undefined
				}
				data-serialization-ms={
					compilation.status === "ready"
						? compilation.artifact.timings.serialization
						: undefined
				}
				data-activation-ms={
					activeFont.status === "ready" ? activeFont.activation : undefined
				}
				data-paint-ms={paintDuration ?? undefined}
				style={{
					fontFamily: activeFamily === null ? undefined : `"${activeFamily}"`,
					fontSize: `${fontSize}px`,
					fontVariationSettings,
					lineHeight,
				}}
			>
				<preview-proof>{proofText}</preview-proof>
			</preview-scroll>
		</preview-tile>
	)
}
