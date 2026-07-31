import {
	EyeClosedIcon,
	EyeOpenIcon,
	LockClosedIcon,
	LockOpen1Icon,
	TrashIcon,
} from "@radix-ui/react-icons"
import { useState } from "preact/hooks"
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
import { exactObjectBounds } from "./shape-expansion.ts"
import type {
	DesignTileContext,
	DesignTileKind,
} from "./design-tile-registry.ts"
import css from "./DesignTileContent.module.css"
import { PdfPreview } from "./PdfPreview.tsx"
import type {
	ColorDefinition,
	DesignDocument,
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

function DesignPagesTile({ context }: { readonly context: DesignTileContext }) {
	return (
		<design-pages-tile>
			<button type="button" aria-pressed="true" onClick={context.focusCanvas}>
				<page-thumbnail />
				<span>
					<strong>Page 1</strong>
					<small>
						{context.document.page.width} × {context.document.page.height} pt
					</small>
				</span>
			</button>
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
	return (
		<design-canvas-tile>
			<strong>{context.document.title}</strong>
			<span>
				{context.document.page.width} × {context.document.page.height} pt ·{" "}
				{Math.round(context.zoom * 100)}%
			</span>
			<button type="button" onClick={context.focusCanvas}>
				Focus artboard
			</button>
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
	return (
		<design-export-tile>
			<strong>Portable Document Format</strong>
			<span>RGB and CMYK vector fills are preserved through mondrian.pdf.</span>
			<button type="button" onClick={context.exportDocument}>
				Export PDF
			</button>
			<label data-live-preview>
				<input
					type="checkbox"
					checked={previewEnabled}
					onChange={(event) => setPreviewEnabled(event.currentTarget.checked)}
				/>
				<span>Live PDF proof</span>
			</label>
			{previewEnabled ? <PdfPreview document={context.document} /> : null}
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
	return (
		<design-object-tile>
			{object === null ? (
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
						<strong>Exact document bounds</strong>
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
			{kind === "pages" ? (
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
