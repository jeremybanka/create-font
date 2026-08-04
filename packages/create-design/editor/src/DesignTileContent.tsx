import type * as React from "react"
import {
	AlignBottomIcon,
	AlignCenterHorizontallyIcon,
	AlignCenterVerticallyIcon,
	AlignLeftIcon,
	AlignRightIcon,
	AlignTopIcon,
	EyeClosedIcon,
	EyeOpenIcon,
	Link1Icon,
	LinkBreak1Icon,
	LockClosedIcon,
	LockOpen1Icon,
	SpaceBetweenHorizontallyIcon,
	SpaceBetweenVerticallyIcon,
	TrashIcon,
} from "@radix-ui/react-icons"
import {
	TileButton,
	TileButtonGroup,
	TileNumericField,
	TileSelect,
	TileTextField,
} from "@create-art/editor"
import { useMemo, useState } from "react"
import type {
	AppearancePaintTarget,
	AppearancePaintValue,
} from "./appearance.ts"
import {
	cmykToRgb,
	oppositeColorSpace,
	resolveDesignBlend,
	resolvedCmyk,
	resolvedRgb,
	rgbToCmyk,
	swatchCss,
} from "@create-design/model"
import { DESIGN_TOOLS } from "./design-tools.ts"
import {
	artboardPreset,
	DESIGN_ARTBOARD_PRESETS,
	type DesignArtboardPresetId,
} from "./artboard-operations.ts"
import type { DesignSnapCategory } from "./design-canvas.ts"
import { exactObjectBounds } from "./shape-expansion.ts"
import { visibleObjectBounds } from "@create-design/model"
import type {
	DesignTileContext,
	DesignTileKind,
} from "./design-tile-registry.ts"
import type {
	DesignAlignmentTarget,
	DesignTransformOrigin,
} from "./design-arrangement.ts"
import css from "./DesignTileContent.module.css"
import { PdfPreview } from "./PdfPreview.tsx"
import { SvgPreview } from "./SvgPreview.tsx"
import { PngPreview } from "./PngPreview.tsx"
import { preflightPngExport, type PngExportRequest } from "@create-design/png"
import {
	preflightSvgExport,
	type SvgDiagnostic,
	type SvgExportTarget,
} from "@create-design/svg"
import { resolvePdfArtboards, type PdfExportRequest } from "@create-design/pdf"
import { preflightPdfExport } from "@create-design/pdf"
import {
	ARTWORK_OUTSIDE_ARTBOARDS_LINT,
	type ExportDiagnostic,
	type ExportPreflightPreferences,
} from "@create-design/pdf"
import { DesignVersionControlTile } from "./DesignVersionControlTile.tsx"
import { DesignFontCombobox } from "./DesignFontCombobox.tsx"
import type {
	ColorDefinition,
	DesignDocument,
	DesignBlend,
	DesignObject,
	DesignStroke,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

const svg = {
	AlignBottom: AlignBottomIcon,
	AlignCenterHorizontally: AlignCenterHorizontallyIcon,
	AlignCenterVertically: AlignCenterVerticallyIcon,
	AlignLeft: AlignLeftIcon,
	AlignRight: AlignRightIcon,
	AlignTop: AlignTopIcon,
	EyeClosed: EyeClosedIcon,
	EyeOpen: EyeOpenIcon,
	Link: Link1Icon,
	LinkBreak: LinkBreak1Icon,
	LockClosed: LockClosedIcon,
	LockOpen: LockOpen1Icon,
	SpaceBetweenHorizontally: SpaceBetweenHorizontallyIcon,
	SpaceBetweenVertically: SpaceBetweenVerticallyIcon,
	Trash: TrashIcon,
}

function ArtboardNameInput({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const [name, setName] = useState(context.activeArtboard.name)
	const commit = (): void => {
		const trimmed = name.trim()
		if (trimmed.length === 0) setName(context.activeArtboard.name)
		else if (trimmed !== context.activeArtboard.name)
			context.setArtboardProperty({ name: trimmed })
	}
	return (
		<artboard-name-input>
			<label data-field>
				<span>Artboard name</span>
				<input
					value={name}
					onInput={(event) => setName(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return
						commit()
						event.currentTarget.blur()
					}}
				/>
			</label>
		</artboard-name-input>
	)
}

function DesignPagesTile({ context }: { readonly context: DesignTileContext }) {
	const artboard = context.activeArtboard
	const index = context.document.artboards.findIndex(
		({ id }) => id === artboard.id,
	)
	const setNumber = (
		property: "x" | "y" | "width" | "height",
		value: number,
	): void => {
		if (!Number.isFinite(value)) return
		if ((property === "width" || property === "height") && value <= 0) return
		context.setArtboardProperty({ [property]: value })
	}
	return (
		<design-pages-tile aria-label="Document artboards">
			<page-actions role="toolbar" aria-label="Artboard actions">
				<button type="button" onClick={context.createArtboard}>
					New
				</button>
				<button type="button" onClick={context.duplicateArtboard}>
					Duplicate
				</button>
				<button
					type="button"
					disabled={context.document.artboards.length === 1}
					onClick={context.deleteArtboard}
				>
					Delete
				</button>
			</page-actions>
			<artboard-list role="listbox" aria-label="Artboards">
				{context.document.artboards.map((candidate, candidateIndex) => (
					<button
						key={candidate.id}
						type="button"
						role="option"
						aria-selected={candidate.id === artboard.id}
						aria-current={candidate.id === artboard.id ? "page" : undefined}
						onClick={() => context.activateArtboard(candidate, true)}
						onKeyDown={(event) => {
							const direction =
								event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
							if (direction === 0) return
							event.preventDefault()
							const next =
								context.document.artboards[candidateIndex + direction]
							if (next !== undefined) context.activateArtboard(next)
						}}
					>
						<page-thumbnail
							style={{
								aspectRatio: `${candidate.width} / ${candidate.height}`,
							}}
						/>
						<span>
							<strong>{candidate.name}</strong>
							<small>
								{candidate.width} × {candidate.height} pt
							</small>
						</span>
					</button>
				))}
			</artboard-list>
			<ArtboardNameInput key={artboard.id + artboard.name} context={context} />
			<label data-field>
				<span>Preset</span>
				<select
					aria-label="Artboard preset"
					value=""
					onChange={(event) => {
						const preset = artboardPreset(
							event.currentTarget.value as DesignArtboardPresetId,
						)
						context.setArtboardProperty({
							width: preset.width,
							height: preset.height,
						})
					}}
				>
					<option value="" disabled>
						Choose a size…
					</option>
					{DESIGN_ARTBOARD_PRESETS.map((preset) => (
						<option key={preset.id} value={preset.id}>
							{preset.name} — {preset.width} × {preset.height}
						</option>
					))}
				</select>
			</label>
			<artboard-number-grid>
				{(["x", "y", "width", "height"] as const).map((property) => (
					<label key={property} data-field>
						<span>
							{property === "width"
								? "W"
								: property === "height"
									? "H"
									: property.toUpperCase()}
						</span>
						<input
							type="number"
							step="any"
							value={artboard[property]}
							onChange={(event) =>
								setNumber(property, event.currentTarget.valueAsNumber)
							}
						/>
					</label>
				))}
			</artboard-number-grid>
			<page-actions role="toolbar" aria-label="Artboard order and orientation">
				<button
					type="button"
					onClick={() =>
						context.setArtboardProperty({
							width: artboard.height,
							height: artboard.width,
						})
					}
				>
					Swap orientation
				</button>
				<button
					type="button"
					disabled={index === 0}
					onClick={() => context.reorderArtboard(-1)}
				>
					Move up
				</button>
				<button
					type="button"
					disabled={index === context.document.artboards.length - 1}
					onClick={() => context.reorderArtboard(1)}
				>
					Move down
				</button>
			</page-actions>
			<page-actions role="toolbar" aria-label="Fit artboards">
				<button type="button" onClick={context.focusCanvas}>
					Fit active
				</button>
				<button type="button" onClick={context.fitAllArtboards}>
					Fit all
				</button>
			</page-actions>
			<label data-artwork-preference>
				<input
					type="checkbox"
					checked={context.moveArtworkWithArtboard}
					onChange={(event) =>
						context.setMoveArtworkWithArtboard(event.currentTarget.checked)
					}
				/>
				<span>Move intersecting artwork with artboard</span>
			</label>
		</design-pages-tile>
	)
}

function DesignLayersTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	return (
		<design-layers-tile>
			<strong>
				{context.document.objects.length} objects ·{" "}
				{context.document.blends?.length ?? 0} live blends
			</strong>
			{[...(context.document.blends ?? [])].reverse().map((blend) => (
				<button
					key={blend.id}
					type="button"
					data-layer-kind="blend"
					aria-label={`Select live blend ${blend.name}`}
					aria-pressed={context.selectedBlend?.id === blend.id}
					onClick={() => context.selectBlend(blend)}
				>
					<i data-layer-color />
					<span>{blend.name}</span>
					<layer-icons>
						<small>{blend.steps} steps</small>
						{blend.locked ? <svg.LockClosed /> : null}
					</layer-icons>
				</button>
			))}
			{[...context.document.objects].reverse().map((object) => {
				const swatch = context.document.swatches.find(
					(candidate) =>
						candidate.id ===
						(object.appearance.fill?.swatchId ??
							object.appearance.stroke?.swatchId),
				)
				return (
					<button
						key={object.id}
						type="button"
						aria-pressed={context.selectedObjectIds.includes(object.id)}
						onClick={(event) =>
							context.selectObject(
								object,
								event.shiftKey || event.metaKey || event.ctrlKey,
							)
						}
					>
						<i
							data-layer-color
							style={{
								background:
									swatch === undefined ? "transparent" : swatchCss(swatch),
							}}
						/>
						<span>{object.name}</span>
						<layer-icons>
							{object.hidden ? <svg.EyeClosed /> : <svg.EyeOpen />}
							{object.locked ? <svg.LockClosed /> : null}
						</layer-icons>
					</button>
				)
			})}
		</design-layers-tile>
	)
}

function DesignCanvasTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const snapCategories = [
		["artboards", "Artboard edges and centers"],
		["guides", "Guides"],
		["objectBounds", "Object bounds"],
		["anchors", "Anchors"],
		["controlPoints", "Control points"],
	] as const satisfies readonly (readonly [DesignSnapCategory, string])[]
	return (
		<design-canvas-tile>
			<label data-field>
				<span>Document title</span>
				<input
					aria-label="Document title"
					value={context.document.title}
					onInput={(event) =>
						context.setDocumentTitle(event.currentTarget.value)
					}
				/>
			</label>
			<span>
				{context.activeArtboard.width} × {context.activeArtboard.height} pt ·{" "}
				{Math.round(context.zoom * 100)}%
			</span>
			<button type="button" onClick={context.focusCanvas}>
				Focus artboard
			</button>
			<strong>Smart snapping</strong>
			<snap-options role="group" aria-label="Snap categories">
				{snapCategories.map(([category, label]) => (
					<label key={category}>
						<input
							type="checkbox"
							checked={context.snapSettings.enabled[category]}
							onChange={(event) =>
								context.setSnapCategory(category, event.currentTarget.checked)
							}
						/>
						<span>{label}</span>
					</label>
				))}
				<label>
					<span>Threshold</span>
					<input
						type="range"
						min={1}
						max={24}
						value={context.snapSettings.thresholdPixels}
						onInput={(event) =>
							context.setSnapThreshold(event.currentTarget.valueAsNumber)
						}
					/>
					<output>{context.snapSettings.thresholdPixels} px</output>
				</label>
			</snap-options>
			<strong>Guides</strong>
			{context.document.guides.length === 0 ? (
				<span>Click a ruler to create a guide.</span>
			) : (
				<guide-list>
					{context.document.guides.map((guide) => (
						<guide-row
							key={guide.id}
							data-selected={context.selectedGuideId === guide.id || undefined}
						>
							<button
								type="button"
								onClick={() => context.selectGuide(guide.id)}
							>
								{guide.axis.toUpperCase()} {Number(guide.value.toFixed(2))} pt
							</button>
							<button
								type="button"
								aria-label={guide.locked ? "Unlock guide" : "Lock guide"}
								onClick={() => context.toggleGuideLock(guide.id)}
							>
								{guide.locked ? <svg.LockClosed /> : <svg.LockOpen />}
							</button>
							<button
								type="button"
								aria-label="Delete guide"
								disabled={guide.locked}
								onClick={() => context.deleteGuide(guide.id)}
							>
								<svg.Trash />
							</button>
						</guide-row>
					))}
				</guide-list>
			)}
		</design-canvas-tile>
	)
}

function DesignToolsTile({ context }: { readonly context: DesignTileContext }) {
	return (
		<design-tools-tile role="toolbar" aria-label="Tools">
			{(
				Object.entries(DESIGN_TOOLS) as readonly [
					DesignTool,
					(typeof DESIGN_TOOLS)[DesignTool],
				][]
			).map(([id, definition]) => {
				const svg = { Icon: definition.icon }
				const disabled =
					(id === "text" || id === "area-text") &&
					context.textToolsDisabledReason !== null
				return (
					<button
						key={id}
						type="button"
						title={
							disabled
								? (context.textToolsDisabledReason ?? definition.label)
								: `${definition.label} (${definition.key})`
						}
						aria-label={definition.label}
						aria-pressed={context.tool === id}
						disabled={disabled}
						aria-description={
							disabled
								? (context.textToolsDisabledReason ?? undefined)
								: undefined
						}
						onClick={() => context.selectTool(id)}
					>
						<svg.Icon aria-hidden="true" />
						<span>{definition.label}</span>
						<kbd>{definition.key}</kbd>
					</button>
				)
			})}
		</design-tools-tile>
	)
}

function DesignExportTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const [previewEnabled, setPreviewEnabled] = useState(false)
	const [svgPreviewEnabled, setSvgPreviewEnabled] = useState(false)
	const [pngPreviewEnabled, setPngPreviewEnabled] = useState(false)
	const [pngScale, setPngScale] = useState(1)
	const [pngBackground, setPngBackground] = useState("transparent")
	const [svgImportDiagnostics, setSvgImportDiagnostics] = useState<
		readonly SvgDiagnostic[]
	>([])
	const [scope, setScope] =
		useState<PdfExportRequest["scope"]["kind"]>("active")
	const [selectedArtboardIds, setSelectedArtboardIds] = useState<
		readonly string[]
	>([context.activeArtboard.id])
	const [rangeStartId, setRangeStartId] = useState(context.activeArtboard.id)
	const [rangeEndId, setRangeEndId] = useState(context.activeArtboard.id)
	const [includeBleed, setIncludeBleed] = useState(false)
	const [checkOutsideArtwork, setCheckOutsideArtwork] = useState(false)
	const selectedIds = useMemo(() => {
		const valid = context.document.artboards
			.filter(({ id }) => selectedArtboardIds.includes(id))
			.map(({ id }) => id)
		return valid.length === 0 ? [context.activeArtboard.id] : valid
	}, [
		context.activeArtboard.id,
		context.document.artboards,
		selectedArtboardIds,
	])
	const startId = context.document.artboards.some(
		({ id }) => id === rangeStartId,
	)
		? rangeStartId
		: context.activeArtboard.id
	const endId = context.document.artboards.some(({ id }) => id === rangeEndId)
		? rangeEndId
		: context.activeArtboard.id
	const target = useMemo<PdfExportRequest>(() => {
		const exportScope: PdfExportRequest["scope"] =
			scope === "all"
				? { kind: "all" }
				: scope === "selected"
					? { kind: "selected", artboardIds: selectedIds }
					: scope === "range"
						? {
								kind: "range",
								startArtboardId: startId,
								endArtboardId: endId,
							}
						: { kind: "active", artboardId: context.activeArtboard.id }
		return { scope: exportScope, includeBleed }
	}, [
		context.activeArtboard.id,
		endId,
		includeBleed,
		scope,
		selectedIds,
		startId,
	])
	const pageCount = resolvePdfArtboards(context.document, target).length
	const preflightPreferences = useMemo<ExportPreflightPreferences>(
		() => ({
			enabledLints: checkOutsideArtwork ? [ARTWORK_OUTSIDE_ARTBOARDS_LINT] : [],
		}),
		[checkOutsideArtwork],
	)
	const preflight = useMemo(
		() =>
			preflightPdfExport(
				context.document,
				target,
				preflightPreferences,
				context.textService,
			),
		[
			context.document,
			context.textFontRevision,
			context.textService,
			preflightPreferences,
			target,
		],
	)
	const diagnosticGroups = useMemo(() => {
		const groups = new Map<
			string,
			Readonly<{ label: string; diagnostics: ExportDiagnostic[] }>
		>()
		groups.set("document", { label: "Document", diagnostics: [] })
		for (const artboard of context.document.artboards)
			groups.set(artboard.id, {
				label: artboard.name,
				diagnostics: [],
			})
		for (const diagnostic of preflight.diagnostics) {
			const artboard = context.document.artboards.find(
				({ id }) => id === diagnostic.artboardId,
			)
			const key = artboard?.id ?? "document"
			const group = groups.get(key) ?? {
				label: artboard?.name ?? "Document",
				diagnostics: [],
			}
			group.diagnostics.push(diagnostic)
			groups.set(key, group)
		}
		return [...groups.entries()].filter(
			([, { diagnostics }]) => diagnostics.length > 0,
		)
	}, [context.document.artboards, preflight.diagnostics])
	const followDiagnostic = (diagnostic: ExportDiagnostic): void => {
		const action = diagnostic.action
		if (action?.kind === "select-entity" && action.entityKind === "object") {
			const object = context.document.objects.find(
				({ id }) => id === action.entityId,
			)
			if (object !== undefined) context.selectObject(object)
		}
		if (action?.kind === "activate-artboard") {
			const artboard = context.document.artboards.find(
				({ id }) => id === action.artboardId,
			)
			if (artboard !== undefined) context.activateArtboard(artboard, true)
		}
	}
	const canExport = preflight.decision === "ready"
	const svgTarget = useMemo<SvgExportTarget>(
		() => ({ artboardId: context.activeArtboard.id }),
		[context.activeArtboard.id],
	)
	const svgPreflight = useMemo(
		() => preflightSvgExport(context.document, svgTarget),
		[context.document, svgTarget],
	)
	const pngRequest = useMemo<PngExportRequest>(
		() => ({
			scope: target.scope,
			scale: pngScale,
			background:
				pngBackground === "transparent"
					? { kind: "transparent" }
					: {
							kind: "color",
							r: Number.parseInt(pngBackground.slice(1, 3), 16),
							g: Number.parseInt(pngBackground.slice(3, 5), 16),
							b: Number.parseInt(pngBackground.slice(5, 7), 16),
						},
		}),
		[pngBackground, pngScale, target.scope],
	)
	const pngPreflight = useMemo(
		() => preflightPngExport(context.document, pngRequest),
		[context.document, pngRequest],
	)
	return (
		<design-export-tile>
			<strong>Portable Document Format</strong>
			<span>
				RGB and CMYK vector fills and strokes are preserved through
				mondrian.pdf.
			</span>
			<label data-field>
				<span>Pages</span>
				<select
					data-export-scope
					value={scope}
					onChange={(event) =>
						setScope(
							event.currentTarget.value as PdfExportRequest["scope"]["kind"],
						)
					}
				>
					<option value="active">Active artboard</option>
					<option value="all">All artboards</option>
					<option value="selected">Selected artboards</option>
					<option value="range">Artboard range</option>
				</select>
			</label>
			{scope !== "selected" ? null : (
				<fieldset data-export-selection>
					<legend>Selected artboards</legend>
					{context.document.artboards.map((artboard) => (
						<label key={artboard.id}>
							<input
								type="checkbox"
								checked={selectedIds.includes(artboard.id)}
								onChange={(event) =>
									setSelectedArtboardIds((current) =>
										event.currentTarget.checked
											? [...new Set([...current, artboard.id])]
											: current.filter((id) => id !== artboard.id),
									)
								}
							/>
							<span>{artboard.name}</span>
						</label>
					))}
				</fieldset>
			)}
			{scope !== "range" ? null : (
				<export-range>
					<label data-field>
						<span>From</span>
						<select
							value={startId}
							onChange={(event) => setRangeStartId(event.currentTarget.value)}
						>
							{context.document.artboards.map((artboard) => (
								<option key={artboard.id} value={artboard.id}>
									{artboard.name}
								</option>
							))}
						</select>
					</label>
					<label data-field>
						<span>To</span>
						<select
							value={endId}
							onChange={(event) => setRangeEndId(event.currentTarget.value)}
						>
							{context.document.artboards.map((artboard) => (
								<option key={artboard.id} value={artboard.id}>
									{artboard.name}
								</option>
							))}
						</select>
					</label>
				</export-range>
			)}
			<label data-include-bleed>
				<input
					type="checkbox"
					checked={includeBleed}
					onChange={(event) => setIncludeBleed(event.currentTarget.checked)}
				/>
				<span>Include authored bleed</span>
			</label>
			<label data-outside-artwork-lint>
				<input
					type="checkbox"
					checked={checkOutsideArtwork}
					onChange={(event) =>
						setCheckOutsideArtwork(event.currentTarget.checked)
					}
				/>
				<span>Check artwork outside exported artboards</span>
			</label>
			{preflight.diagnostics.length === 0 ? null : (
				<details
					aria-live="polite"
					data-export-preflight
					data-decision={preflight.decision}
					open={preflight.decision === "blocked"}
				>
					<summary>
						<strong>Preflight</strong>
						<span>
							{preflight.summary.errors} errors · {preflight.summary.warnings}{" "}
							warnings · {preflight.summary.infos} notices
						</span>
					</summary>
					{diagnosticGroups.map(([key, group]) => (
						<section key={key} aria-label={`${group.label} diagnostics`}>
							<strong>{group.label}</strong>
							<ul>
								{group.diagnostics.map((diagnostic, index) => (
									<li
										key={`${diagnostic.code}:${diagnostic.entityId ?? diagnostic.artboardId ?? index}`}
										data-severity={diagnostic.severity}
									>
										<span>
											<strong>{diagnostic.severity}</strong>{" "}
											{diagnostic.message}
										</span>
										{diagnostic.action?.kind === "select-entity" &&
										diagnostic.action.entityKind === "object" ? (
											<button
												type="button"
												onClick={() => followDiagnostic(diagnostic)}
											>
												Select object
											</button>
										) : diagnostic.action?.kind === "activate-artboard" &&
										  context.document.artboards.some(
												({ id }) => id === diagnostic.artboardId,
										  ) ? (
											<button
												type="button"
												onClick={() => followDiagnostic(diagnostic)}
											>
												Show artboard
											</button>
										) : null}
									</li>
								))}
							</ul>
						</section>
					))}
				</details>
			)}
			<button
				type="button"
				disabled={!canExport}
				onClick={() => context.exportDocument(target, preflightPreferences)}
			>
				Export {pageCount} page{pageCount === 1 ? "" : "s"} as PDF
			</button>
			<label data-live-preview>
				<input
					type="checkbox"
					checked={previewEnabled}
					onChange={(event) => setPreviewEnabled(event.currentTarget.checked)}
				/>
				<span>Live PDF proof</span>
			</label>
			{previewEnabled ? (
				<PdfPreview
					document={context.document}
					target={target}
					preflightPreferences={preflightPreferences}
					{...(context.textService === undefined
						? {}
						: { textService: context.textService })}
				/>
			) : null}
			<hr />
			<strong>Scalable Vector Graphics</strong>
			<span>
				Export or import the supported vector subset through the same headless
				SVG pipeline used by preview and the CLI.
			</span>
			{svgPreflight.diagnostics.length === 0 ? null : (
				<ul aria-label="SVG export diagnostics" data-export-preflight>
					{svgPreflight.diagnostics.map((diagnostic, index) => (
						<li
							key={`${diagnostic.code}:${diagnostic.entityId ?? "document"}:${index}`}
							data-severity={diagnostic.severity}
						>
							<strong>{diagnostic.severity}</strong> {diagnostic.message}
						</li>
					))}
				</ul>
			)}
			<button
				type="button"
				disabled={svgPreflight.decision === "blocked"}
				onClick={() => context.exportSvgDocument(svgTarget)}
			>
				Export active artboard as SVG
			</button>
			<label data-field>
				<span>Import SVG into active artboard</span>
				<input
					type="file"
					accept="image/svg+xml,.svg"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0]
						if (file === undefined) return
						void file.text().then((source) => {
							const result = context.importSvgDocument(source)
							setSvgImportDiagnostics(result.diagnostics)
						})
						event.currentTarget.value = ""
					}}
				/>
			</label>
			{svgImportDiagnostics.length === 0 ? null : (
				<ul
					aria-live="polite"
					aria-label="SVG import diagnostics"
					data-export-preflight
				>
					{svgImportDiagnostics.map((diagnostic, index) => (
						<li
							key={`${diagnostic.code}:${index}`}
							data-severity={diagnostic.severity}
						>
							<strong>{diagnostic.stage}</strong> {diagnostic.message}
						</li>
					))}
				</ul>
			)}
			<label data-live-preview>
				<input
					type="checkbox"
					checked={svgPreviewEnabled}
					onChange={(event) =>
						setSvgPreviewEnabled(event.currentTarget.checked)
					}
				/>
				<span>Live SVG proof</span>
			</label>
			{svgPreviewEnabled ? (
				<SvgPreview document={context.document} target={svgTarget} />
			) : null}
			<hr />
			<strong>Portable Network Graphics</strong>
			<span>
				Rasterize the chosen artboard scope through the same deterministic,
				headless pipeline used by the CLI and live proof.
			</span>
			<label data-field>
				<span>Scale</span>
				<select
					value={pngScale}
					onChange={(event) => setPngScale(Number(event.currentTarget.value))}
				>
					<option value={1}>1×</option>
					<option value={2}>2×</option>
					<option value={4}>4×</option>
				</select>
			</label>
			<label data-field>
				<span>Background</span>
				<select
					value={pngBackground}
					onChange={(event) => setPngBackground(event.currentTarget.value)}
				>
					<option value="transparent">Transparent</option>
					<option value="#ffffff">White</option>
					<option value="#000000">Black</option>
				</select>
			</label>
			{pngPreflight.diagnostics.length === 0 ? null : (
				<ul aria-label="PNG export diagnostics" data-export-preflight>
					{pngPreflight.diagnostics.map((diagnostic, index) => (
						<li
							key={`${diagnostic.code}:${diagnostic.artboardId ?? "document"}:${diagnostic.entityId ?? index}`}
							data-severity={diagnostic.severity}
						>
							<strong>{diagnostic.severity}</strong> {diagnostic.message}
						</li>
					))}
				</ul>
			)}
			<button
				type="button"
				disabled={pngPreflight.decision === "blocked"}
				onClick={() => context.exportPngDocument(pngRequest)}
			>
				Export {pngPreflight.artboards.length} artboard
				{pngPreflight.artboards.length === 1 ? "" : "s"} as PNG
			</button>
			<label data-live-preview>
				<input
					type="checkbox"
					checked={pngPreviewEnabled}
					onChange={(event) =>
						setPngPreviewEnabled(event.currentTarget.checked)
					}
				/>
				<span>Live PNG proof (opt in)</span>
			</label>
			{pngPreviewEnabled ? (
				<PngPreview document={context.document} request={pngRequest} />
			) : null}
		</design-export-tile>
	)
}

const TRANSFORM_ORIGINS = [
	{ id: "top-left", label: "Top left" },
	{ id: "top", label: "Top center" },
	{ id: "top-right", label: "Top right" },
	{ id: "left", label: "Center left" },
	{ id: "center", label: "Center" },
	{ id: "right", label: "Center right" },
	{ id: "bottom-left", label: "Bottom left" },
	{ id: "bottom", label: "Bottom center" },
	{ id: "bottom-right", label: "Bottom right" },
] as const satisfies readonly Readonly<{
	id: DesignTransformOrigin
	label: string
}>[]

function inspectorNumber(value: number): number {
	const rounded = Math.round(value * 1_000) / 1_000
	return Object.is(rounded, -0) ? 0 : rounded
}

function TransformOriginPicker({
	disabled = false,
	onChange,
	value,
}: Readonly<{
	disabled?: boolean
	onChange: (origin: DesignTransformOrigin) => void
	value: DesignTransformOrigin
}>) {
	const selectIndex = (index: number, grid?: HTMLElement | null): void => {
		const origin = TRANSFORM_ORIGINS[index]
		if (origin === undefined) return
		onChange(origin.id)
		grid?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus()
	}
	const navigate = (
		event: React.KeyboardEvent<HTMLButtonElement>,
		index: number,
	): void => {
		const row = Math.floor(index / 3)
		const column = index % 3
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? TRANSFORM_ORIGINS.length - 1
					: event.key === "ArrowLeft"
						? row * 3 + Math.max(0, column - 1)
						: event.key === "ArrowRight"
							? row * 3 + Math.min(2, column + 1)
							: event.key === "ArrowUp"
								? Math.max(0, row - 1) * 3 + column
								: event.key === "ArrowDown"
									? Math.min(2, row + 1) * 3 + column
									: null
		if (next === null) return
		event.preventDefault()
		selectIndex(next, event.currentTarget.closest("transform-origin-grid"))
	}
	return (
		<transform-origin-picker>
			<span>Origin</span>
			<transform-origin-grid
				role="radiogroup"
				aria-label="Transform origin"
				aria-disabled={disabled || undefined}
			>
				{TRANSFORM_ORIGINS.map((origin, index) => (
					<button
						key={origin.id}
						type="button"
						disabled={disabled}
						role="radio"
						aria-label={origin.label}
						aria-checked={origin.id === value}
						title={origin.label}
						tabIndex={!disabled && origin.id === value ? 0 : -1}
						onClick={() => selectIndex(index)}
						onKeyDown={(event) => navigate(event, index)}
					>
						<span aria-hidden="true" />
					</button>
				))}
			</transform-origin-grid>
			<small aria-live="polite">
				{TRANSFORM_ORIGINS.find(({ id }) => id === value)?.label}
			</small>
		</transform-origin-picker>
	)
}

function selectionCountLabel(context: DesignTileContext): string {
	return context.selectedObjectCount === 0
		? "No selection"
		: context.selectedObjectCount === 1
			? "1 selected"
			: `${context.selectedObjectCount} selected`
}

function DesignTransformTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const [origin, setOrigin] = useState<DesignTransformOrigin>("center")
	const [constrainProportions, setConstrainProportions] = useState(false)
	const selectionBounds = context.selectionBounds
	const transformDisabledReason =
		selectionBounds === null
			? "Select one or more objects to transform."
			: (context.selectionTransformDisabledReason ?? null)
	const originX =
		selectionBounds === null
			? 0
			: origin.endsWith("left") || origin === "left"
				? selectionBounds.minX
				: origin.endsWith("right") || origin === "right"
					? selectionBounds.maxX
					: (selectionBounds.minX + selectionBounds.maxX) / 2
	const originY =
		selectionBounds === null
			? 0
			: origin.startsWith("top") || origin === "top"
				? selectionBounds.minY
				: origin.startsWith("bottom") || origin === "bottom"
					? selectionBounds.maxY
					: (selectionBounds.minY + selectionBounds.maxY) / 2
	const width =
		selectionBounds === null ? 0 : selectionBounds.maxX - selectionBounds.minX
	const height =
		selectionBounds === null ? 0 : selectionBounds.maxY - selectionBounds.minY
	const displayedOriginX = inspectorNumber(originX)
	const displayedOriginY = inspectorNumber(originY)
	const displayedWidth = inspectorNumber(width)
	const displayedHeight = inspectorNumber(height)
	const degenerate = width === 0 || height === 0
	const constrainDisabledReason =
		transformDisabledReason ??
		(degenerate
			? "A zero-width or zero-height selection has no proportion to preserve."
			: null)
	return (
		<design-transform-tile>
			<selection-transform-editor aria-label="Selection transform">
				<transform-editor-heading>
					<strong>Selection</strong>
					<span>{selectionCountLabel(context)}</span>
				</transform-editor-heading>
				<transform-disabled-reason
					role="note"
					data-active={transformDisabledReason !== null || undefined}
				>
					{transformDisabledReason ??
						"Position, size, and rotation apply to the complete selection."}
				</transform-disabled-reason>
				<TransformOriginPicker
					value={origin}
					disabled={transformDisabledReason !== null}
					onChange={setOrigin}
				/>
				<transform-number-grid>
					<TileNumericField
						label="Selection X"
						value={displayedOriginX}
						step="any"
						arrowStep={1}
						disabled={transformDisabledReason !== null}
						onCommit={(x) => context.transformSelection({ origin, x })}
					/>
					<TileNumericField
						label="Selection Y"
						value={displayedOriginY}
						step="any"
						arrowStep={1}
						disabled={transformDisabledReason !== null}
						onCommit={(y) => context.transformSelection({ origin, y })}
					/>
					<TileNumericField
						label="Selection width"
						min={0}
						value={displayedWidth}
						step="any"
						arrowStep={1}
						disabled={transformDisabledReason !== null}
						onCommit={(nextWidth) =>
							context.transformSelection({
								origin,
								width: nextWidth,
								constrainProportions,
							})
						}
					/>
					<TileNumericField
						label="Selection height"
						min={0}
						value={displayedHeight}
						step="any"
						arrowStep={1}
						disabled={transformDisabledReason !== null}
						onCommit={(nextHeight) =>
							context.transformSelection({
								origin,
								height: nextHeight,
								constrainProportions,
							})
						}
					/>
					<transform-rotation-field>
						<TileNumericField
							label="Rotate by degrees"
							value={0}
							step="any"
							arrowStep={1}
							resetAfterCommit
							disabled={transformDisabledReason !== null}
							onCommit={(rotation) =>
								context.transformSelection({ origin, rotation })
							}
						/>
					</transform-rotation-field>
				</transform-number-grid>
				<TileButton
					aria-label="Constrain proportions"
					aria-pressed={constrainProportions}
					disabled={constrainDisabledReason !== null}
					style={{ justifyContent: "flex-start", width: "100%" }}
					title={constrainDisabledReason ?? "Preserve width-to-height ratio"}
					onClick={() => setConstrainProportions((current) => !current)}
				>
					{constrainProportions ? <svg.Link /> : <svg.LinkBreak />}
					Constrain proportions
				</TileButton>
			</selection-transform-editor>
		</design-transform-tile>
	)
}

function DesignArrangeTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const [alignmentTarget, setAlignmentTarget] =
		useState<DesignAlignmentTarget>("selection")
	const transformDisabledReason =
		context.selectionBounds === null
			? "Select one or more objects to arrange."
			: (context.selectionTransformDisabledReason ?? null)
	const arrangementUnitCount =
		context.selectionArrangementUnitCount ?? context.selectedObjectCount
	const alignmentDisabledReason =
		transformDisabledReason ??
		(alignmentTarget === "artboard"
			? null
			: arrangementUnitCount < 2
				? `Select at least two objects to align to the ${alignmentTarget === "key-object" ? "key object" : "selection"}.`
				: null)
	const distributionDisabledReason =
		transformDisabledReason ??
		(arrangementUnitCount < 3
			? "Select at least three objects to distribute them."
			: null)
	return (
		<design-arrange-tile>
			<selection-arrangement-controls aria-label="Selection arrangement">
				<arrangement-heading>
					<strong>Selection</strong>
					<span>{selectionCountLabel(context)}</span>
				</arrangement-heading>
				<TileSelect
					label="Align to"
					value={alignmentTarget}
					disabled={transformDisabledReason !== null}
					onChange={(event) =>
						setAlignmentTarget(
							event.currentTarget.value as DesignAlignmentTarget,
						)
					}
				>
					<option value="selection">Selection</option>
					<option value="key-object">Key object</option>
					<option value="artboard">Active artboard</option>
				</TileSelect>
				<TileButtonGroup aria-label="Align selection" compact>
					{(
						[
							["left", svg.AlignLeft],
							["center", svg.AlignCenterHorizontally],
							["right", svg.AlignRight],
							["top", svg.AlignTop],
							["middle", svg.AlignCenterVertically],
							["bottom", svg.AlignBottom],
						] as const
					).map(([alignment, Icon]) => (
						<TileButton
							key={alignment}
							compact
							iconOnly
							aria-label={`Align ${alignment}`}
							title={alignmentDisabledReason ?? `Align ${alignment}`}
							disabled={alignmentDisabledReason !== null}
							onClick={() =>
								context.alignSelection(
									alignment,
									alignmentTarget,
									context.selectedObjectIds.at(-1),
								)
							}
						>
							<Icon />
						</TileButton>
					))}
				</TileButtonGroup>
				<TileButtonGroup aria-label="Distribute selection" compact>
					<TileButton
						compact
						aria-label="Distribute horizontally"
						title={distributionDisabledReason ?? "Distribute horizontally"}
						disabled={distributionDisabledReason !== null}
						onClick={() => context.distributeSelection("x")}
					>
						<svg.SpaceBetweenHorizontally /> Horizontal
					</TileButton>
					<TileButton
						compact
						aria-label="Distribute vertically"
						title={distributionDisabledReason ?? "Distribute vertically"}
						disabled={distributionDisabledReason !== null}
						onClick={() => context.distributeSelection("y")}
					>
						<svg.SpaceBetweenVertically /> Vertical
					</TileButton>
				</TileButtonGroup>
				<arrangement-help data-kind="alignment">
					{alignmentDisabledReason ??
						"Choose an edge or center to align the selection."}
				</arrangement-help>
				<arrangement-help data-kind="distribution">
					{distributionDisabledReason ??
						"Distribute three or more objects with equal spacing."}
				</arrangement-help>
			</selection-arrangement-controls>
		</design-arrange-tile>
	)
}

type ObjectGeometryField = Readonly<{
	disabled: boolean
	label: string
	onChange?: (value: number) => void
	value: number
}>

function objectGeometryFields(
	context: DesignTileContext,
	object: DesignObject | null,
): readonly ObjectGeometryField[] {
	if (object?.geometry.kind === "rectangle") {
		const geometry = object.geometry
		return [
			{
				disabled: false,
				label: "Local X",
				value: geometry.x,
				onChange: (x) => context.setObjectGeometry(object, { ...geometry, x }),
			},
			{
				disabled: false,
				label: "Local Y",
				value: geometry.y,
				onChange: (y) => context.setObjectGeometry(object, { ...geometry, y }),
			},
			{
				disabled: false,
				label: "Width",
				value: geometry.width,
				onChange: (width) =>
					context.setObjectGeometry(object, { ...geometry, width }),
			},
			{
				disabled: false,
				label: "Height",
				value: geometry.height,
				onChange: (height) =>
					context.setObjectGeometry(object, { ...geometry, height }),
			},
		]
	}
	if (object?.geometry.kind === "ellipse") {
		const geometry = object.geometry
		return [
			{
				disabled: false,
				label: "Center X",
				value: geometry.centerX,
				onChange: (centerX) =>
					context.setObjectGeometry(object, { ...geometry, centerX }),
			},
			{
				disabled: false,
				label: "Center Y",
				value: geometry.centerY,
				onChange: (centerY) =>
					context.setObjectGeometry(object, { ...geometry, centerY }),
			},
			{
				disabled: false,
				label: "Radius X",
				value: geometry.radiusX,
				onChange: (radiusX) =>
					context.setObjectGeometry(object, { ...geometry, radiusX }),
			},
			{
				disabled: false,
				label: "Radius Y",
				value: geometry.radiusY,
				onChange: (radiusY) =>
					context.setObjectGeometry(object, { ...geometry, radiusY }),
			},
		]
	}
	return ["Local X", "Local Y", "Width", "Height"].map((label) => ({
		disabled: true,
		label,
		value: 0,
	}))
}

function objectSelectionSummary(
	context: DesignTileContext,
	object: DesignObject | null,
): string {
	if (context.tool === "direct" && context.selectedObjectCount > 0)
		return `Direct selection: ${context.directSelectionSummary}`
	if (context.selectedObjectCount > 1)
		return `${context.selectedObjectCount} objects selected. Select one object to edit its properties.`
	if (object === null) return "Select one object to inspect its properties."
	return `${object.name} is selected.`
}

function DesignObjectTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const object = context.selectedObject
	const interactionBounds = context.selectedObjectBounds ?? null
	const bounds =
		object?.geometry.kind === "text" && interactionBounds !== null
			? {
					x: interactionBounds.minX,
					y: interactionBounds.minY,
					width: interactionBounds.maxX - interactionBounds.minX,
					height: interactionBounds.maxY - interactionBounds.minY,
				}
			: object === null
				? null
				: exactObjectBounds(object)
	const visibleBounds =
		object?.geometry.kind === "text"
			? interactionBounds
			: object === null
				? null
				: visibleObjectBounds(object)
	const geometryFields = objectGeometryFields(context, object)
	const geometryLabel =
		object?.geometry.kind === "rectangle"
			? "Live rectangle"
			: object?.geometry.kind === "ellipse"
				? "Live ellipse"
				: object?.geometry.kind === "path"
					? "Path geometry"
					: "Object geometry"
	return (
		<design-object-tile>
			<object-selection-summary role="status">
				{objectSelectionSummary(context, object)}
			</object-selection-summary>
			<TileTextField
				label="Name"
				value={object?.name ?? ""}
				placeholder="No single object selected"
				disabled={object === null}
				onChange={(event) =>
					object === null
						? undefined
						: context.setObjectProperty(object, {
								name: event.currentTarget.value,
							})
				}
			/>
			<object-geometry-editor>
				<strong>{geometryLabel}</strong>
				<shape-number-grid>
					{geometryFields.map((field) => (
						<ShapeNumberInput
							key={field.label}
							label={field.label}
							value={field.value}
							disabled={field.disabled}
							{...(field.label === "Width" ||
							field.label === "Height" ||
							field.label.startsWith("Radius")
								? { min: 0 }
								: {})}
							{...(field.onChange === undefined
								? {}
								: { onChange: field.onChange })}
						/>
					))}
				</shape-number-grid>
				<object-geometry-help>
					{object?.geometry.kind === "path"
						? "Edit path coordinates with Direct Selection."
						: object === null
							? "Select one object to edit exact geometry."
							: "Live geometry remains editable until expanded."}
				</object-geometry-help>
				<strong>
					{object?.geometry.kind === "text"
						? "Text interaction bounds"
						: "Geometric document bounds"}
				</strong>
				<shape-number-grid>
					<ShapeNumberInput
						disabled={bounds === null}
						label="Bounds X"
						value={bounds?.x ?? 0}
					/>
					<ShapeNumberInput
						disabled={bounds === null}
						label="Bounds Y"
						value={bounds?.y ?? 0}
					/>
					<ShapeNumberInput
						disabled={bounds === null}
						label="Bounds width"
						value={bounds?.width ?? 0}
					/>
					<ShapeNumberInput
						disabled={bounds === null}
						label="Bounds height"
						value={bounds?.height ?? 0}
					/>
				</shape-number-grid>
				<strong>Visible document bounds</strong>
				<shape-number-grid>
					<ShapeNumberInput
						disabled={visibleBounds === null}
						label="Visible X"
						value={visibleBounds?.minX ?? 0}
					/>
					<ShapeNumberInput
						disabled={visibleBounds === null}
						label="Visible Y"
						value={visibleBounds?.minY ?? 0}
					/>
					<ShapeNumberInput
						disabled={visibleBounds === null}
						label="Visible width"
						value={
							visibleBounds === null
								? 0
								: visibleBounds.maxX - visibleBounds.minX
						}
					/>
					<ShapeNumberInput
						disabled={visibleBounds === null}
						label="Visible height"
						value={
							visibleBounds === null
								? 0
								: visibleBounds.maxY - visibleBounds.minY
						}
					/>
				</shape-number-grid>
			</object-geometry-editor>
			<button
				type="button"
				data-expand-shape
				disabled={context.expansionDisabledReason !== null}
				aria-describedby="expand-shape-eligibility"
				onClick={context.expandSelection}
			>
				Expand Shape
			</button>
			<p id="expand-shape-eligibility">
				{context.expansionDisabledReason ??
					"Converts this live shape to ordinary editable cubic path geometry."}
			</p>
			<button
				type="button"
				data-expand-stroke
				disabled={context.strokeExpansionDisabledReason !== null}
				aria-describedby="expand-stroke-eligibility"
				onClick={context.expandStrokeSelection}
			>
				Expand Stroke
			</button>
			<p id="expand-stroke-eligibility">
				{context.strokeExpansionDisabledReason ??
					"Converts the visible stroke to ordinary editable filled contours."}
			</p>
			<design-object-actions>
				<TileButton
					aria-pressed={object?.hidden ?? false}
					disabled={object === null}
					onClick={() =>
						object === null
							? undefined
							: context.setObjectProperty(object, {
									hidden: !object.hidden,
								})
					}
				>
					{object?.hidden ? <svg.EyeClosed /> : <svg.EyeOpen />}
					{object?.hidden ? "Hidden" : "Visible"}
				</TileButton>
				<TileButton
					aria-pressed={object?.locked ?? false}
					disabled={object === null}
					onClick={() =>
						object === null
							? undefined
							: context.setObjectProperty(object, {
									locked: !object.locked,
								})
					}
				>
					{object?.locked ? <svg.LockClosed /> : <svg.LockOpen />}
					{object?.locked ? "Locked" : "Unlocked"}
				</TileButton>
			</design-object-actions>
			<TileButton
				tone="danger"
				disabled={context.selectedObjectCount === 0}
				onClick={context.deleteSelection}
			>
				<svg.Trash /> Delete selection
			</TileButton>
		</design-object-tile>
	)
}

function BlendNameInput({
	blend,
	context,
}: Readonly<{ blend: DesignBlend; context: DesignTileContext }>) {
	const [name, setName] = useState(blend.name)
	const commit = (): void => {
		const trimmed = name.trim()
		if (trimmed.length === 0) setName(blend.name)
		else if (trimmed !== blend.name)
			context.setBlendProperty(blend, { name: trimmed })
	}
	return (
		<blend-name-input>
			<label data-field>
				<span>Blend name</span>
				<input
					aria-label="Blend name"
					value={name}
					onInput={(event) => setName(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return
						commit()
						event.currentTarget.blur()
					}}
				/>
			</label>
		</blend-name-input>
	)
}

function DesignBlendTile({ context }: { readonly context: DesignTileContext }) {
	const blend = context.selectedBlend
	const resolution =
		blend === null ? null : resolveDesignBlend(context.document, blend)
	const endpoint = (kind: "start" | "end") =>
		blend === null
			? undefined
			: context.document.objects.find(
					({ id }) =>
						id === (kind === "start" ? blend.startObjectId : blend.endObjectId),
				)
	return (
		<design-blend-tile aria-label="Live blend editor">
			<strong>Live contour blend</strong>
			<button
				type="button"
				aria-describedby="make-blend-eligibility"
				disabled={context.blendCreationDisabledReason !== null}
				onClick={context.makeBlend}
			>
				Make Blend
			</button>
			<p id="make-blend-eligibility">
				{context.blendCreationDisabledReason ??
					"Create a live blend from the two selected objects; endpoints remain ordinary objects."}
			</p>
			{blend === null ? (
				<p>Select a live blend on the canvas or in Layers to edit it.</p>
			) : (
				<blend-editor>
					<BlendNameInput
						key={`${blend.id}:${blend.name}`}
						blend={blend}
						context={context}
					/>
					<TileNumericField
						label="Specified steps"
						value={blend.steps}
						min={1}
						max={10_000}
						step={1}
						arrowStep={1}
						onCommit={(steps) => context.setBlendProperty(blend, { steps })}
					/>
					<small>
						{blend.steps} intermediate path{blend.steps === 1 ? "" : "s"};
						endpoints are retained.
					</small>
					{(["start", "end"] as const).map((kind) => {
						const object = endpoint(kind)
						const editable = object?.geometry.kind === "path" && !object.locked
						return (
							<blend-endpoint key={kind} data-endpoint={kind}>
								<strong>
									{kind === "start" ? "Start" : "End"}:{" "}
									{object?.name ?? "Missing"}
								</strong>
								<button
									type="button"
									disabled={!editable}
									title={
										editable
											? `Reverse ${kind} endpoint direction`
											: "Direction editing requires an unlocked ordinary path endpoint."
									}
									onClick={() => context.reverseBlendEndpoint(kind)}
								>
									Reverse {kind} direction
								</button>
								{object?.geometry.kind !== "path"
									? null
									: object.geometry.contours.map((contour, contourIndex) => (
											<label key={contour.id} data-field>
												<span>Contour {contourIndex + 1} first point</span>
												<select
													aria-label={`${kind === "start" ? "Start" : "End"} contour ${contourIndex + 1} first point`}
													disabled={!editable || !contour.closed}
													value={contour.points[0]?.id ?? ""}
													onChange={(event) =>
														context.setBlendFirstPoint(
															kind,
															contour.id,
															event.currentTarget.value,
														)
													}
												>
													{contour.points.map((point, pointIndex) => (
														<option key={point.id} value={point.id}>
															Point {pointIndex + 1}
														</option>
													))}
												</select>
											</label>
										))}
							</blend-endpoint>
						)
					})}
					{context.blendDiagnosticMessages.length === 0 ? (
						<p role="status">Blend is ready and previews live.</p>
					) : (
						<ul aria-label="Blend diagnostics" aria-live="polite">
							{context.blendDiagnosticMessages.map((message) => (
								<li key={message}>{message}</li>
							))}
						</ul>
					)}
					<button
						type="button"
						data-expand-blend
						disabled={resolution?.status !== "ready" || blend.locked}
						aria-describedby="expand-blend-policy"
						onClick={context.expandBlend}
					>
						Expand Blend
					</button>
					<p id="expand-blend-policy">
						Retains both endpoint objects and replaces the live blend with
						selected, ordinary editable intermediate paths in the same stacking
						position.
					</p>
				</blend-editor>
			)}
		</design-blend-tile>
	)
}

function ShapeNumberInput({
	disabled = false,
	label,
	min,
	onChange,
	value,
}: {
	readonly disabled?: boolean
	readonly label: string
	readonly min?: number
	readonly onChange?: (value: number) => void
	readonly value: number
}) {
	return (
		<shape-number-input>
			<label>
				<span>{label}</span>
				<input
					type="number"
					value={value}
					disabled={disabled}
					{...(min === undefined ? {} : { min })}
					readOnly={disabled || onChange === undefined}
					onInput={
						onChange === undefined
							? undefined
							: (event) => onChange(Number(event.currentTarget.value))
					}
				/>
			</label>
		</shape-number-input>
	)
}

function ChannelInput({
	label,
	max,
	onChange,
	value,
}: {
	readonly label: string
	readonly max: number
	readonly onChange: (value: number) => void
	readonly value: number
}) {
	return (
		<channel-input>
			<label>
				<span>{label}</span>
				<input
					type="number"
					min={0}
					max={max}
					step={1}
					value={value}
					onInput={(event) => onChange(Number(event.currentTarget.value))}
				/>
			</label>
		</channel-input>
	)
}

function ColorChannels({
	color,
	onChange,
}: {
	readonly color: ColorDefinition
	readonly onChange: (color: ColorDefinition) => void
}) {
	return (
		<color-channels>
			{color.space === "rgb" ? (
				<>
					<ChannelInput
						label="R"
						value={color.r}
						max={255}
						onChange={(r) => onChange({ ...color, r })}
					/>
					<ChannelInput
						label="G"
						value={color.g}
						max={255}
						onChange={(g) => onChange({ ...color, g })}
					/>
					<ChannelInput
						label="B"
						value={color.b}
						max={255}
						onChange={(b) => onChange({ ...color, b })}
					/>
				</>
			) : (
				<>
					<ChannelInput
						label="C"
						value={color.c}
						max={100}
						onChange={(c) => onChange({ ...color, c })}
					/>
					<ChannelInput
						label="M"
						value={color.m}
						max={100}
						onChange={(m) => onChange({ ...color, m })}
					/>
					<ChannelInput
						label="Y"
						value={color.y}
						max={100}
						onChange={(y) => onChange({ ...color, y })}
					/>
					<ChannelInput
						label="K"
						value={color.k}
						max={100}
						onChange={(k) => onChange({ ...color, k })}
					/>
				</>
			)}
		</color-channels>
	)
}

function SwatchEditor({
	onChange,
	swatch,
}: {
	readonly onChange: (swatch: DesignSwatch) => void
	readonly swatch: DesignSwatch
}) {
	const source = swatch.source
	const automatic =
		source.space === "rgb" ? rgbToCmyk(source) : cmykToRgb(source)
	const alternate = swatch.alternate ?? automatic
	const updateSource = (next: ColorDefinition): void =>
		onChange({ ...swatch, source: next })
	const updateAlternate = (next: ColorDefinition): void =>
		onChange({ ...swatch, alternate: next })
	return (
		<swatch-editor>
			<label data-field>
				<span>Swatch name</span>
				<input
					value={swatch.name}
					onChange={(event) =>
						onChange({ ...swatch, name: event.currentTarget.value })
					}
				/>
			</label>
			<color-space-tabs role="group" aria-label="Source color space">
				{(["rgb", "cmyk"] as const).map((space) => (
					<button
						key={space}
						type="button"
						aria-pressed={source.space === space}
						onClick={() => {
							if (source.space === space) return
							onChange({
								...swatch,
								source:
									space === "rgb" ? resolvedRgb(swatch) : resolvedCmyk(swatch),
								alternate: undefined,
							})
						}}
					>
						{space.toUpperCase()}
					</button>
				))}
			</color-space-tabs>
			<ColorChannels color={source} onChange={updateSource} />
			<label data-manual-toggle>
				<input
					type="checkbox"
					checked={swatch.alternate !== undefined}
					onChange={(event) =>
						onChange({
							...swatch,
							alternate: event.currentTarget.checked ? automatic : undefined,
						})
					}
				/>
				<span>
					Manual {oppositeColorSpace(source).toUpperCase()} equivalent
				</span>
			</label>
			{swatch.alternate === undefined ? (
				<p>
					Automatic {oppositeColorSpace(source).toUpperCase()}:{" "}
					{alternate.space === "rgb"
						? `${alternate.r}, ${alternate.g}, ${alternate.b}`
						: `${alternate.c}, ${alternate.m}, ${alternate.y}, ${alternate.k}`}
				</p>
			) : (
				<alternate-color>
					<ColorChannels color={alternate} onChange={updateAlternate} />
				</alternate-color>
			)}
		</swatch-editor>
	)
}

function appearancePaintLabel(
	value: AppearancePaintValue,
	document: DesignDocument,
): string {
	if (value === "mixed") return "Mixed"
	if (value === null) return "None"
	return document.swatches.find((swatch) => swatch.id === value)?.name ?? value
}

function AppearancePaintControl({
	context,
	target,
}: {
	readonly context: DesignTileContext
	readonly target: AppearancePaintTarget
}) {
	const value = context.appearanceSummary[target]
	const label = appearancePaintLabel(value, context.document)
	const swatch =
		typeof value === "string" && value !== "mixed"
			? context.document.swatches.find((candidate) => candidate.id === value)
			: undefined
	const describedBy = "appearance-eligibility"
	return (
		<appearance-paint-control
			data-target={target}
			data-mixed={value === "mixed"}
		>
			<button
				type="button"
				data-paint-target
				aria-label={`${target === "fill" ? "Fill" : "Stroke"} paint: ${label}`}
				aria-keyshortcuts="X"
				aria-pressed={context.appearanceTarget === target}
				aria-describedby={describedBy}
				disabled={context.appearanceDisabledReason !== null}
				onClick={() => context.setAppearanceTarget(target)}
			>
				<i
					data-appearance-chip
					data-none={swatch === undefined}
					style={swatch === undefined ? {} : { background: swatchCss(swatch) }}
				/>
				<span>
					<strong>{target === "fill" ? "Fill" : "Stroke"}</strong>
					<small>{label}</small>
				</span>
			</button>
			<button
				type="button"
				data-paint-none
				aria-label={`Set ${target} paint to none`}
				aria-describedby={describedBy}
				disabled={context.appearanceDisabledReason !== null}
				onClick={() => context.applyAppearancePaint(target, undefined)}
			>
				None
			</button>
		</appearance-paint-control>
	)
}

function numberPropertyValue(value: number | null | "mixed"): string {
	return typeof value === "number" ? String(value) : ""
}

function propertyPlaceholder(value: unknown): string | undefined {
	return value === "mixed" ? "Mixed" : value === null ? "No stroke" : undefined
}

function StrokeDashArrayControl({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const value = context.appearanceSummary.strokeStyle.dashArray
	const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : "")
	const commit = (): void => {
		const entries = text
			.split(/[\s,]+/u)
			.filter(Boolean)
			.map(Number)
		context.applyStrokeProperties({ dashArray: entries })
	}
	return (
		<stroke-dash-array-control>
			<label data-stroke-field>
				<span>Dash pattern</span>
				<input
					type="text"
					inputMode="decimal"
					value={text}
					placeholder={propertyPlaceholder(value) ?? "Solid"}
					aria-label="Stroke dash pattern"
					aria-describedby="stroke-properties-eligibility"
					disabled={context.strokePropertiesDisabledReason !== null}
					onInput={(event) => setText(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							commit()
							event.currentTarget.blur()
						}
					}}
				/>
			</label>
		</stroke-dash-array-control>
	)
}

function StrokePropertiesEditor({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const style = context.appearanceSummary.strokeStyle
	const disabled = context.strokePropertiesDisabledReason !== null
	const numberInput = (
		label: string,
		property: "width" | "miterLimit" | "dashOffset",
		minimum?: number,
	) => (
		<label data-stroke-field>
			<span>{label}</span>
			<input
				type="number"
				step="any"
				{...(minimum === undefined ? {} : { min: minimum })}
				value={numberPropertyValue(style[property])}
				placeholder={propertyPlaceholder(style[property])}
				aria-label={`Stroke ${label.toLowerCase()}`}
				aria-describedby="stroke-properties-eligibility"
				disabled={disabled}
				onInput={(event) => {
					const value = event.currentTarget.valueAsNumber
					if (Number.isFinite(value))
						context.applyStrokeProperties({ [property]: value })
				}}
			/>
		</label>
	)
	const select = <Property extends "cap" | "join">(
		label: string,
		property: Property,
		options: readonly DesignStroke[Property][],
	) => (
		<label data-stroke-field>
			<span>{label}</span>
			<select
				value={
					style[property] === null || style[property] === "mixed"
						? ""
						: style[property]
				}
				aria-label={`Stroke ${label.toLowerCase()}`}
				aria-describedby="stroke-properties-eligibility"
				disabled={disabled}
				onChange={(event) =>
					context.applyStrokeProperties({
						[property]: event.currentTarget.value,
					} as Partial<Omit<DesignStroke, "swatchId">>)
				}
			>
				<option value="" disabled>
					{propertyPlaceholder(style[property])}
				</option>
				{options.map((option) => (
					<option key={option} value={option}>
						{option[0]?.toUpperCase()}
						{option.slice(1)}
					</option>
				))}
			</select>
		</label>
	)
	const dashKey = Array.isArray(style.dashArray)
		? style.dashArray.join(",")
		: String(style.dashArray)
	return (
		<stroke-properties-editor role="group" aria-label="Stroke properties">
			<strong>Stroke properties</strong>
			{numberInput("Width", "width", 0)}
			{select("Cap", "cap", ["butt", "round", "square"])}
			{select("Join", "join", ["miter", "round", "bevel"])}
			{numberInput("Miter limit", "miterLimit", 1)}
			<StrokeDashArrayControl key={dashKey} context={context} />
			{numberInput("Dash offset", "dashOffset")}
			<p id="stroke-properties-eligibility">
				{context.strokePropertiesDisabledReason ??
					"Stroke properties apply to the complete selection and new objects."}
			</p>
		</stroke-properties-editor>
	)
}

function DesignAppearanceTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	return (
		<design-appearance-tile>
			<appearance-editor role="group" aria-label="Object appearance">
				<appearance-heading>
					<strong>Fill and stroke</strong>
					<span>
						{context.selectedObjectCount === 0
							? "New objects"
							: context.selectedObjectCount === 1
								? "1 selected object"
								: `${context.selectedObjectCount} selected objects`}
					</span>
					<kbd title="Toggle the active fill or stroke target">X</kbd>
				</appearance-heading>
				<AppearancePaintControl context={context} target="fill" />
				<AppearancePaintControl context={context} target="stroke" />
				<StrokePropertiesEditor context={context} />
				<button
					type="button"
					data-swap-appearance
					aria-label="Swap fill and stroke paints"
					aria-keyshortcuts="Shift+X"
					aria-describedby="appearance-eligibility"
					disabled={context.appearanceDisabledReason !== null}
					onClick={context.swapAppearancePaints}
				>
					Swap fill and stroke <kbd>Shift+X</kbd>
				</button>
				<p id="appearance-eligibility">
					{context.appearanceDisabledReason ??
						(context.selectedObjectCount === 0
							? "Changes set the appearance used by new Pen, rectangle, and ellipse objects."
							: "Changes apply to the complete selection in one history entry and become the default for new objects.")}
				</p>
			</appearance-editor>
			<swatch-list>
				{context.document.swatches.map((swatch) => (
					<button
						key={swatch.id}
						type="button"
						aria-label={`Use ${swatch.name} as ${context.appearanceTarget} paint`}
						aria-pressed={context.selectedSwatchId === swatch.id}
						aria-describedby="appearance-eligibility"
						disabled={context.appearanceDisabledReason !== null}
						onClick={() => {
							context.selectSwatch(swatch)
							context.applyAppearancePaint(context.appearanceTarget, swatch.id)
						}}
					>
						<i data-swatch-chip style={{ background: swatchCss(swatch) }} />
						<span>
							<strong>{swatch.name}</strong>
							<small>
								{swatch.source.space.toUpperCase()}
								{swatch.alternate === undefined ? " · auto" : " · manual"}
							</small>
						</span>
					</button>
				))}
				<button type="button" data-add-swatch onClick={context.addSwatch}>
					+ New swatch
				</button>
			</swatch-list>
			{context.selectedSwatch === undefined ? null : (
				<SwatchEditor
					swatch={context.selectedSwatch}
					onChange={context.updateSwatch}
				/>
			)}
		</design-appearance-tile>
	)
}

function DesignTypographyTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const object =
		context.selectedObject?.geometry.kind === "text"
			? context.selectedObject
			: null
	const typography =
		object?.geometry.kind === "text" ? object.geometry.typography : null
	const frame =
		object?.geometry.kind === "text" && object.geometry.mode === "area"
			? object.geometry.frame
			: undefined
	const controlsDisabled =
		typography === null || context.textToolsDisabledReason !== null
	const number = (
		label: string,
		value: number,
		onChange: (value: number) => void,
		minimum?: number,
	) => (
		<label data-field data-number-field>
			<span>{label}</span>
			<input
				type="number"
				step="any"
				value={value}
				disabled={controlsDisabled}
				{...(minimum === undefined ? {} : { min: minimum })}
				onChange={(event) => {
					const next = event.currentTarget.valueAsNumber
					if (Number.isFinite(next)) onChange(next)
				}}
			/>
		</label>
	)
	return (
		<design-typography-tile>
			<typography-heading>
				<strong>Typography</strong>
				<span>{object?.name ?? "New text defaults"}</span>
			</typography-heading>
			<typography-font-section aria-label="Workspace font">
				<label data-field>
					<span>Font family</span>
					<DesignFontCombobox
						label="Font family"
						fonts={context.availableTextFonts}
						selectedFontId={context.activeTextFontId}
						disabled={context.textToolsDisabledReason !== null}
						onSelect={context.selectTextFont}
					/>
				</label>
				<label data-font-upload>
					<span>Add font</span>
					<input
						type="file"
						aria-label="Add OpenType font to workspace"
						accept=".otf,.ttf,.woff,.woff2,font/otf,font/ttf,font/woff,font/woff2"
						onChange={(event) => {
							const file = event.currentTarget.files?.[0]
							if (file !== undefined) void context.registerTextFont(file)
						}}
					/>
				</label>
			</typography-font-section>
			{context.textToolsDisabledReason === null ? null : (
				<typography-empty-state role="status">
					<strong>No workspace fonts yet</strong>
					<span>{context.textToolsDisabledReason}</span>
					<small>Add an OTF, TTF, WOFF, or WOFF2 file above to begin.</small>
				</typography-empty-state>
			)}
			<typography-selection-status role="status">
				{object === null
					? "Select text to edit its type settings. Font choice applies to the next text object."
					: `${object.name}: settings apply to the complete object${context.textSelectionRange === null ? "." : `, including outside range ${context.textSelectionRange.start}–${context.textSelectionRange.end}.`}`}
			</typography-selection-status>
			{object === null ? (
				<typography-conversion>
					<button
						type="button"
						disabled={context.areaTextConversionDisabledReason !== null}
						title={context.areaTextConversionDisabledReason ?? undefined}
						onClick={context.convertSelectionToAreaText}
					>
						Convert rectangle to Area Type
					</button>
					<small>{context.areaTextConversionDisabledReason}</small>
				</typography-conversion>
			) : null}
			<typography-controls aria-label="Type settings">
				<strong>Type settings</strong>
				<shape-number-grid>
					{number(
						"Size",
						typography?.size ?? 0,
						(size) => context.applyTextTypography({ size }),
						0.01,
					)}
					{number(
						"Leading",
						typography?.leading ?? 0,
						(leading) => context.applyTextTypography({ leading }),
						0.01,
					)}
					{number("Tracking", typography?.tracking ?? 0, (tracking) =>
						context.applyTextTypography({ tracking }),
					)}
					{number(
						"Kerning",
						typography?.kerning === "auto" ? 0 : (typography?.kerning ?? 0),
						(kerning) => context.applyTextTypography({ kerning }),
					)}
				</shape-number-grid>
				<typography-select-grid>
					<label data-field>
						<span>Kerning</span>
						<select
							disabled={controlsDisabled}
							value={typography?.kerning === "auto" ? "auto" : "manual"}
							onChange={(event) =>
								context.applyTextTypography({
									kerning: event.currentTarget.value === "auto" ? "auto" : 0,
								})
							}
						>
							<option value="auto">Automatic</option>
							<option value="manual">Manual</option>
						</select>
					</label>
					<label data-field>
						<span>Align</span>
						<select
							disabled={controlsDisabled}
							value={typography?.alignment ?? "start"}
							onChange={(event) =>
								context.applyTextTypography({
									alignment: event.currentTarget.value as
										| "start"
										| "center"
										| "end"
										| "justify",
								})
							}
						>
							<option value="start">Start</option>
							<option value="center">Center</option>
							<option value="end">End</option>
							<option value="justify">Justify</option>
						</select>
					</label>
					<label data-field>
						<span>Direction</span>
						<select
							disabled={controlsDisabled}
							value={typography?.direction ?? "auto"}
							onChange={(event) =>
								context.applyTextTypography({
									direction: event.currentTarget.value as
										| "auto"
										| "ltr"
										| "rtl"
										| "ttb"
										| "btt",
								})
							}
						>
							<option value="auto">Automatic</option>
							<option value="ltr">Left to right</option>
							<option value="rtl">Right to left</option>
							<option value="ttb">Top to bottom</option>
							<option value="btt">Bottom to top</option>
						</select>
					</label>
				</typography-select-grid>
			</typography-controls>
			{frame === undefined ? null : (
				<area-text-controls>
					<area-text-heading>
						<strong>Area frame</strong>
						<span>{context.textOverset ? "Overset" : "Fits"}</span>
					</area-text-heading>
					<shape-number-grid>
						{number(
							"Width",
							frame.width,
							(width) => context.applyAreaTextFrame({ width }),
							0.01,
						)}
						{number(
							"Height",
							frame.height,
							(height) => context.applyAreaTextFrame({ height }),
							0.01,
						)}
						{number(
							"Top inset",
							frame.inset.top,
							(top) =>
								context.applyAreaTextFrame({ inset: { ...frame.inset, top } }),
							0,
						)}
						{number(
							"Right inset",
							frame.inset.right,
							(right) =>
								context.applyAreaTextFrame({
									inset: { ...frame.inset, right },
								}),
							0,
						)}
						{number(
							"Bottom inset",
							frame.inset.bottom,
							(bottom) =>
								context.applyAreaTextFrame({
									inset: { ...frame.inset, bottom },
								}),
							0,
						)}
						{number(
							"Left inset",
							frame.inset.left,
							(left) =>
								context.applyAreaTextFrame({ inset: { ...frame.inset, left } }),
							0,
						)}
					</shape-number-grid>
					<label data-field>
						<span>Vertical alignment</span>
						<select
							disabled={controlsDisabled}
							value={frame.verticalAlignment}
							onChange={(event) =>
								context.applyAreaTextFrame({
									verticalAlignment: event.currentTarget.value as
										| "top"
										| "center"
										| "bottom",
								})
							}
						>
							<option value="top">Top</option>
							<option value="center">Center</option>
							<option value="bottom">Bottom</option>
						</select>
					</label>
					<area-text-status role="status" aria-live="polite">
						{context.textOverset
							? "Overset text: hidden characters remain editable. Enlarge the frame or reduce the type."
							: "All source characters fit in the frame."}
					</area-text-status>
				</area-text-controls>
			)}
			<typography-actions>
				<button
					type="button"
					disabled={object === null || context.textToolsDisabledReason !== null}
					onClick={() =>
						object === null ? undefined : context.beginTextEditing(object)
					}
				>
					Edit text
				</button>
				<button
					type="button"
					data-expand-text
					disabled={context.textExpansionDisabledReason !== null}
					onClick={context.expandTextSelection}
				>
					Expand Text
				</button>
			</typography-actions>
			<typography-action-help>
				{context.textExpansionDisabledReason ??
					"Expand Text replaces live text with grouped glyph paths in one undoable entry."}
			</typography-action-help>
		</design-typography-tile>
	)
}

export function DesignTileContent({
	context,
	kind,
}: {
	readonly context: DesignTileContext
	readonly kind: DesignTileKind
}) {
	return (
		<design-tile-content className={css.class}>
			{kind === "version-control" ? (
				<DesignVersionControlTile context={context} />
			) : kind === "pages" ? (
				<DesignPagesTile context={context} />
			) : kind === "layers" ? (
				<DesignLayersTile context={context} />
			) : kind === "canvas" ? (
				<DesignCanvasTile context={context} />
			) : kind === "tools" ? (
				<DesignToolsTile context={context} />
			) : kind === "export" ? (
				<DesignExportTile context={context} />
			) : kind === "object" ? (
				<DesignObjectTile context={context} />
			) : kind === "blend" ? (
				<DesignBlendTile context={context} />
			) : kind === "transform" ? (
				<DesignTransformTile context={context} />
			) : kind === "arrange" ? (
				<DesignArrangeTile context={context} />
			) : kind === "typography" ? (
				<DesignTypographyTile context={context} />
			) : (
				<DesignAppearanceTile context={context} />
			)}
		</design-tile-content>
	)
}
