import {
	EyeClosedIcon,
	EyeOpenIcon,
	LockClosedIcon,
	LockOpen1Icon,
	TrashIcon,
} from "@radix-ui/react-icons"
import { useMemo, useState } from "preact/hooks"
import type {
	AppearancePaintTarget,
	AppearancePaintValue,
} from "./appearance.ts"
import {
	cmykToRgb,
	oppositeColorSpace,
	resolvedCmyk,
	resolvedRgb,
	rgbToCmyk,
	swatchCss,
} from "./color.ts"
import { DESIGN_TOOLS } from "./design-tools.ts"
import {
	artboardPreset,
	DESIGN_ARTBOARD_PRESETS,
	type DesignArtboardPresetId,
} from "./artboard-operations.ts"
import type { DesignSnapCategory } from "./design-canvas.ts"
import { exactObjectBounds } from "./shape-expansion.ts"
import { visibleObjectBounds } from "./painted-geometry.ts"
import type {
	DesignTileContext,
	DesignTileKind,
} from "./design-tile-registry.ts"
import css from "./DesignTileContent.module.css"
import { PdfPreview } from "./PdfPreview.tsx"
import { resolvePdfArtboards, type PdfExportRequest } from "./pdf.ts"
import { DesignVersionControlTile } from "./DesignVersionControlTile.tsx"
import type {
	ColorDefinition,
	DesignDocument,
	DesignStroke,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

const svg = {
	EyeClosed: EyeClosedIcon,
	EyeOpen: EyeOpenIcon,
	LockClosed: LockClosedIcon,
	LockOpen: LockOpen1Icon,
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
			<strong>{context.document.objects.length} objects</strong>
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
			<strong>{context.document.title}</strong>
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
				return (
					<button
						key={id}
						type="button"
						title={`${definition.label} (${definition.key})`}
						aria-label={definition.label}
						aria-pressed={context.tool === id}
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
	const [scope, setScope] =
		useState<PdfExportRequest["scope"]["kind"]>("active")
	const [selectedArtboardIds, setSelectedArtboardIds] = useState<
		readonly string[]
	>([context.activeArtboard.id])
	const [rangeStartId, setRangeStartId] = useState(context.activeArtboard.id)
	const [rangeEndId, setRangeEndId] = useState(context.activeArtboard.id)
	const [includeBleed, setIncludeBleed] = useState(false)
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
			<button type="button" onClick={() => context.exportDocument(target)}>
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
				<PdfPreview document={context.document} target={target} />
			) : null}
		</design-export-tile>
	)
}

function DesignObjectTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const object = context.selectedObject
	const bounds = object === null ? null : exactObjectBounds(object)
	const visibleBounds = object === null ? null : visibleObjectBounds(object)
	return (
		<design-object-tile>
			{context.tool === "direct" && context.selectedObjectCount > 0 ? (
				<p role="status">Direct selection: {context.directSelectionSummary}</p>
			) : context.selectedObjectCount > 1 ? (
				<p role="status">
					{context.selectedObjectCount} objects selected. Appearance and
					transforms apply to the complete selection.
				</p>
			) : object === null ? (
				<p>Select an object to inspect it.</p>
			) : (
				<>
					<label data-field>
						<span>Name</span>
						<input
							value={object.name}
							onChange={(event) =>
								context.setObjectProperty(object, {
									name: event.currentTarget.value,
								})
							}
						/>
					</label>
					<object-geometry-editor>
						<strong>
							{object.geometry.kind === "rectangle"
								? "Live rectangle"
								: object.geometry.kind === "ellipse"
									? "Live ellipse"
									: "Path geometry"}
						</strong>
						{object.geometry.kind === "rectangle" ? (
							<shape-number-grid>
								<ShapeNumberInput
									label="Local X"
									value={object.geometry.x}
									onChange={(x) => {
										if (object.geometry.kind !== "rectangle") return
										context.setObjectGeometry(object, {
											...object.geometry,
											x,
										})
									}}
								/>
								<ShapeNumberInput
									label="Local Y"
									value={object.geometry.y}
									onChange={(y) => {
										if (object.geometry.kind !== "rectangle") return
										context.setObjectGeometry(object, {
											...object.geometry,
											y,
										})
									}}
								/>
								<ShapeNumberInput
									label="Width"
									value={object.geometry.width}
									min={0}
									onChange={(width) => {
										if (object.geometry.kind !== "rectangle") return
										context.setObjectGeometry(object, {
											...object.geometry,
											width,
										})
									}}
								/>
								<ShapeNumberInput
									label="Height"
									value={object.geometry.height}
									min={0}
									onChange={(height) => {
										if (object.geometry.kind !== "rectangle") return
										context.setObjectGeometry(object, {
											...object.geometry,
											height,
										})
									}}
								/>
							</shape-number-grid>
						) : object.geometry.kind === "ellipse" ? (
							<shape-number-grid>
								<ShapeNumberInput
									label="Center X"
									value={object.geometry.centerX}
									onChange={(centerX) => {
										if (object.geometry.kind !== "ellipse") return
										context.setObjectGeometry(object, {
											...object.geometry,
											centerX,
										})
									}}
								/>
								<ShapeNumberInput
									label="Center Y"
									value={object.geometry.centerY}
									onChange={(centerY) => {
										if (object.geometry.kind !== "ellipse") return
										context.setObjectGeometry(object, {
											...object.geometry,
											centerY,
										})
									}}
								/>
								<ShapeNumberInput
									label="Radius X"
									value={object.geometry.radiusX}
									min={0}
									onChange={(radiusX) => {
										if (object.geometry.kind !== "ellipse") return
										context.setObjectGeometry(object, {
											...object.geometry,
											radiusX,
										})
									}}
								/>
								<ShapeNumberInput
									label="Radius Y"
									value={object.geometry.radiusY}
									min={0}
									onChange={(radiusY) => {
										if (object.geometry.kind !== "ellipse") return
										context.setObjectGeometry(object, {
											...object.geometry,
											radiusY,
										})
									}}
								/>
							</shape-number-grid>
						) : null}
						<strong>Geometric document bounds</strong>
						{bounds === null ? (
							<span>No drawable bounds.</span>
						) : (
							<shape-number-grid>
								<ShapeNumberInput label="Bounds X" value={bounds.x} />
								<ShapeNumberInput label="Bounds Y" value={bounds.y} />
								<ShapeNumberInput label="Bounds width" value={bounds.width} />
								<ShapeNumberInput label="Bounds height" value={bounds.height} />
							</shape-number-grid>
						)}
						<strong>Visible document bounds</strong>
						{visibleBounds === null ? (
							<span>No painted bounds.</span>
						) : (
							<shape-number-grid>
								<ShapeNumberInput
									label="Visible X"
									value={visibleBounds.minX}
								/>
								<ShapeNumberInput
									label="Visible Y"
									value={visibleBounds.minY}
								/>
								<ShapeNumberInput
									label="Visible width"
									value={visibleBounds.maxX - visibleBounds.minX}
								/>
								<ShapeNumberInput
									label="Visible height"
									value={visibleBounds.maxY - visibleBounds.minY}
								/>
							</shape-number-grid>
						)}
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
						<button
							type="button"
							onClick={() =>
								context.setObjectProperty(object, {
									hidden: !object.hidden,
								})
							}
						>
							{object.hidden ? <svg.EyeClosed /> : <svg.EyeOpen />}
							{object.hidden ? "Hidden" : "Visible"}
						</button>
						<button
							type="button"
							onClick={() =>
								context.setObjectProperty(object, {
									locked: !object.locked,
								})
							}
						>
							{object.locked ? <svg.LockClosed /> : <svg.LockOpen />}
							{object.locked ? "Locked" : "Unlocked"}
						</button>
					</design-object-actions>
					<button type="button" data-danger onClick={context.deleteSelection}>
						<svg.Trash /> Delete object
					</button>
				</>
			)}
		</design-object-tile>
	)
}

function ShapeNumberInput({
	label,
	min,
	onChange,
	value,
}: {
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
					{...(min === undefined ? {} : { min })}
					readOnly={onChange === undefined}
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
				</appearance-heading>
				<AppearancePaintControl context={context} target="fill" />
				<AppearancePaintControl context={context} target="stroke" />
				<StrokePropertiesEditor context={context} />
				<button
					type="button"
					data-swap-appearance
					aria-label="Swap fill and stroke paints"
					aria-describedby="appearance-eligibility"
					disabled={context.appearanceDisabledReason !== null}
					onClick={context.swapAppearancePaints}
				>
					Swap fill and stroke
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
			) : (
				<DesignAppearanceTile context={context} />
			)}
		</design-tile-content>
	)
}
