import type * as React from "react"
import {
	AlignBottomIcon,
	AlignCenterHorizontallyIcon,
	AlignCenterVerticallyIcon,
	AlignLeftIcon,
	AlignRightIcon,
	AlignTopIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	EyeClosedIcon,
	EyeOpenIcon,
	Link1Icon,
	LinkBreak1Icon,
	LockClosedIcon,
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
	TooltipButton,
	NumericInput,
} from "@create-art/editor"
import { useEffect, useMemo, useRef, useState } from "react"
import {
	DEFAULT_DESIGN_ARTBOARD_BORDER_COLOR,
	DESIGN_LAYER_UI_COLORS,
} from "@create-design/source"
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
	projectDesignEffectiveHierarchy,
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
	DesignHierarchyNode,
	DesignHierarchyParent,
} from "./design-hierarchy.ts"
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
	DesignLayer,
	DesignLayerUiColor,
	DesignObject,
	DesignSceneChild,
	DesignStroke,
	DesignSwatch,
	DesignTool,
} from "./types.ts"
import { designLayerUiColorCss } from "./design-layer-ui-color.ts"

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
							data-transparent={candidate.backgroundColor === undefined}
							style={{
								aspectRatio: `${candidate.width} / ${candidate.height}`,
								borderColor:
									candidate.borderColor ?? DEFAULT_DESIGN_ARTBOARD_BORDER_COLOR,
								...(candidate.backgroundColor === undefined
									? {}
									: { background: candidate.backgroundColor }),
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
			<artboard-appearance-fields>
				<label data-field>
					<span>Background</span>
					<input
						type="color"
						aria-label="Artboard background color"
						value={artboard.backgroundColor ?? "#ffffff"}
						onInput={(event) =>
							context.setArtboardProperty({
								backgroundColor: event.currentTarget.value,
							})
						}
					/>
				</label>
				<button
					type="button"
					disabled={artboard.backgroundColor === undefined}
					onClick={() =>
						context.setArtboardProperty({ backgroundColor: undefined })
					}
				>
					Transparent
				</button>
				<label data-field>
					<span>Border</span>
					<input
						type="color"
						aria-label="Artboard border color"
						value={artboard.borderColor ?? DEFAULT_DESIGN_ARTBOARD_BORDER_COLOR}
						onInput={(event) =>
							context.setArtboardProperty({
								borderColor: event.currentTarget.value,
							})
						}
					/>
				</label>
				<button
					type="button"
					disabled={artboard.borderColor === undefined}
					onClick={() =>
						context.setArtboardProperty({ borderColor: undefined })
					}
				>
					Reset border
				</button>
			</artboard-appearance-fields>
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
	type TreeRow = Readonly<{
		key: string
		kind: "layer" | "group" | "object"
		name: string
		depth: number
		parentKey: string | null
		hasChildren: boolean
		layerId: string | null
		groupScope: readonly string[]
		object?: DesignObject
		descendantCount?: number
	}>
	const groups = useMemo(
		() => new Map(context.document.groups.map((group) => [group.id, group])),
		[context.document.groups],
	)
	const objects = useMemo(
		() =>
			new Map(context.document.objects.map((object) => [object.id, object])),
		[context.document.objects],
	)
	const effective = useMemo(
		() => projectDesignEffectiveHierarchy(context.document),
		[context.document],
	)
	const descendantIds = (children: readonly DesignSceneChild[]): string[] =>
		children.flatMap((child) =>
			child.kind === "object"
				? [child.id]
				: descendantIds(groups.get(child.id)?.children ?? []),
		)
	const branchKeys = useMemo(
		() => [
			...context.document.layers.map(({ id }) => `layer:${id}`),
			...context.document.groups.map(({ id }) => `group:${id}`),
		],
		[context.document.groups, context.document.layers],
	)
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
	const knownBranches = useRef(new Set(branchKeys))
	useEffect(() => {
		const additions = branchKeys.filter(
			(key) => !knownBranches.current.has(key),
		)
		knownBranches.current = new Set(branchKeys)
		if (additions.length > 0)
			setExpanded((current) => new Set([...current, ...additions]))
	}, [branchKeys])
	const rows = useMemo(() => {
		const result: TreeRow[] = []
		const appendChildren = (
			children: readonly DesignSceneChild[],
			layer: DesignLayer,
			parentKey: string,
			depth: number,
			parentScope: readonly string[],
		): void => {
			for (const child of [...children].reverse()) {
				if (child.kind === "object") {
					const object = objects.get(child.id)
					if (object !== undefined)
						result.push({
							key: `object:${object.id}`,
							kind: "object",
							name: object.name,
							depth,
							parentKey,
							hasChildren: false,
							layerId: layer.id,
							groupScope: parentScope,
							object,
						})
					continue
				}
				const group = groups.get(child.id)
				if (group === undefined) continue
				const key = `group:${group.id}`
				const groupScope = [...parentScope, group.id]
				result.push({
					key,
					kind: "group",
					name: group.name,
					depth,
					parentKey,
					hasChildren: group.children.length > 0,
					layerId: layer.id,
					groupScope,
					descendantCount: descendantIds(group.children).length,
				})
				if (expanded.has(key))
					appendChildren(group.children, layer, key, depth + 1, groupScope)
			}
		}
		for (const layer of [...context.document.layers].reverse()) {
			const key = `layer:${layer.id}`
			result.push({
				key,
				kind: "layer",
				name: layer.name,
				depth: 1,
				parentKey: null,
				hasChildren: layer.children.length > 0,
				layerId: layer.id,
				groupScope: [],
				descendantCount: descendantIds(layer.children).length,
			})
			if (expanded.has(key)) appendChildren(layer.children, layer, key, 2, [])
		}
		return result
	}, [context.document, expanded, groups, objects])
	const [focusedKey, setFocusedKey] = useState(
		() => `layer:${context.document.layers.at(-1)!.id}`,
	)
	const [draggedKey, setDraggedKey] = useState<string | null>(null)
	const [dropKey, setDropKey] = useState<string | null>(null)
	const rowRefs = useRef(new Map<string, HTMLElement>())
	useEffect(() => {
		if (!rows.some(({ key }) => key === focusedKey) && rows[0] !== undefined)
			setFocusedKey(rows[0].key)
	}, [focusedKey, rows])
	const focusRow = (key: string): void => {
		setFocusedKey(key)
		rowRefs.current.get(key)?.focus()
		requestAnimationFrame(() => rowRefs.current.get(key)?.focus())
	}
	const toggle = (key: string): void =>
		setExpanded((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	const selectRow = (row: TreeRow, additive = false): void => {
		if (row.kind === "layer") context.selectLayer(row.layerId!)
		else if (row.kind === "group")
			context.selectHierarchyGroup(
				row.key.slice("group:".length),
				row.layerId!,
				row.groupScope.slice(0, -1),
			)
		else if (row.object !== undefined)
			context.selectHierarchyObject(
				row.object,
				row.layerId!,
				row.groupScope,
				additive,
			)
	}
	const nodeForRow = (row: TreeRow): DesignHierarchyNode | null =>
		row.kind === "layer"
			? null
			: { kind: row.kind, id: row.key.slice(row.kind.length + 1) }
	const parentForKey = (key: string): DesignHierarchyParent => {
		const separator = key.indexOf(":")
		return {
			kind: key.slice(0, separator) as DesignHierarchyParent["kind"],
			id: key.slice(separator + 1),
		}
	}
	const childrenForParent = (
		parent: DesignHierarchyParent,
	): readonly DesignSceneChild[] =>
		parent.kind === "layer"
			? (context.document.layers.find(({ id }) => id === parent.id)?.children ??
				[])
			: (groups.get(parent.id)?.children ?? [])
	const moveToRow = (sourceKey: string, target: TreeRow): void => {
		const source = rows.find(({ key }) => key === sourceKey)
		if (source === undefined) return
		const node = nodeForRow(source)
		if (node === null) return
		if (target.kind === "layer" || target.kind === "group") {
			const parent = parentForKey(target.key)
			const length = childrenForParent(parent).length
			context.moveHierarchyNode(
				node,
				parent,
				source.parentKey === target.key ? Math.max(0, length - 1) : length,
			)
			return
		}
		if (target.parentKey === null) return
		const parent = parentForKey(target.parentKey)
		const targetIndex = childrenForParent(parent).findIndex(
			(child) => child.kind === "object" && child.id === target.object?.id,
		)
		if (targetIndex >= 0) {
			const sourceIndex = childrenForParent(parent).findIndex(
				(child) => child.kind === node.kind && child.id === node.id,
			)
			context.moveHierarchyNode(
				node,
				parent,
				targetIndex +
					1 -
					(sourceIndex >= 0 && sourceIndex < targetIndex ? 1 : 0),
			)
		}
	}
	const pathRelated = (row: TreeRow): boolean => {
		if (row.layerId !== context.activeLayerId) return false
		const active = context.activeGroupScope
		if (active.length === 0) return true
		const path = row.groupScope
		return (
			active.every((id, index) => path[index] === id) ||
			path.every((id, index) => active[index] === id)
		)
	}
	const stateLabel = (row: TreeRow): string => {
		if (row.kind === "layer") {
			const layer = context.document.layers.find(
				({ id }) => id === row.layerId,
			)!
			const layerIndex = context.document.layers.findIndex(
				({ id }) => id === layer.id,
			)
			return [
				row.layerId === context.activeLayerId ? "Target layer" : "Layer",
				`UI color ${layer.uiColor ?? DESIGN_LAYER_UI_COLORS[layerIndex % DESIGN_LAYER_UI_COLORS.length]}`,
				`${row.descendantCount ?? 0} descendants`,
				...(layer.hidden ? ["Hidden"] : ["Visible"]),
				...(layer.locked ? ["Locked"] : ["Unlocked"]),
			].join(" · ")
		}
		if (row.kind === "group") {
			const group = groups.get(row.key.slice("group:".length))
			const entries = descendantIds(group?.children ?? []).flatMap((id) => {
				const entry = effective.byObjectId.get(id)
				return entry === undefined ? [] : [entry]
			})
			const hidden = entries.find(({ visible }) => !visible)
			const locked = entries.find((entry) => entry.locked)
			return [
				group?.clippingPathId === undefined ? "Group" : "Clipping mask",
				`${row.descendantCount ?? 0} descendants`,
				...(hidden === undefined
					? []
					: [
							hidden.hiddenBy?.kind === "layer"
								? `Hidden by ${hidden.layer.name} layer`
								: "Contains hidden artwork",
						]),
				...(locked === undefined
					? []
					: [
							locked.lockedBy?.kind === "layer"
								? `Locked by ${locked.layer.name} layer`
								: "Contains locked artwork",
						]),
			].join(" · ")
		}
		const entry = effective.byObjectId.get(row.object!.id)
		return [
			entry?.clippingForGroupId === null ||
			entry?.clippingForGroupId === undefined
				? row.object?.geometry.kind === "image"
					? "Placed image"
					: row.object?.geometry.kind === "artboard-link"
						? `Live linked artboard from ${row.object.geometry.projectId}/${row.object.geometry.artboardId}`
						: "Object"
				: "Clipping path",
			...(entry?.hiddenBy === null || entry?.hiddenBy === undefined
				? ["Visible"]
				: [
						entry.hiddenBy.kind === "layer"
							? `Hidden by ${entry.hiddenBy.name} layer`
							: "Hidden on object",
					]),
			...(entry?.lockedBy === null || entry?.lockedBy === undefined
				? ["Unlocked"]
				: [
						entry.lockedBy.kind === "layer"
							? `Locked by ${entry.lockedBy.name} layer`
							: "Locked on object",
					]),
		].join(" · ")
	}
	const activeScopeNames = context.activeGroupScope.flatMap((id) => {
		const group = groups.get(id)
		return group === undefined ? [] : [{ id, name: group.name }]
	})
	const activeLayer = context.document.layers.find(
		({ id }) => id === context.activeLayerId,
	)!
	const activeLayerIndex = context.document.layers.findIndex(
		({ id }) => id === activeLayer.id,
	)
	const [activeLayerName, setActiveLayerName] = useState(activeLayer.name)
	useEffect(
		() => setActiveLayerName(activeLayer.name),
		[activeLayer.id, activeLayer.name],
	)
	const commitActiveLayerName = (): void => {
		const trimmed = activeLayerName.trim()
		if (trimmed.length === 0) setActiveLayerName(activeLayer.name)
		else context.renameLayer(activeLayer.id, trimmed)
	}
	const selectedHierarchyRow =
		context.selectedGroupId === null
			? context.selectedObjectIds.length === 1
				? rows.find(
						(row) =>
							row.kind === "object" &&
							row.object?.id === context.selectedObjectIds[0],
					)
				: undefined
			: rows.find(
					(row) =>
						row.kind === "group" &&
						row.key === `group:${context.selectedGroupId}`,
				)
	const selectedNode =
		selectedHierarchyRow === undefined ? null : nodeForRow(selectedHierarchyRow)
	const selectedParent =
		selectedHierarchyRow?.parentKey === null ||
		selectedHierarchyRow?.parentKey === undefined
			? null
			: parentForKey(selectedHierarchyRow.parentKey)
	const selectedSiblings =
		selectedParent === null ? [] : childrenForParent(selectedParent)
	const selectedSiblingIndex =
		selectedNode === null
			? -1
			: selectedSiblings.findIndex(
					(child) =>
						child.kind === selectedNode.kind && child.id === selectedNode.id,
				)
	const invalidGroupParents = new Set<string>()
	if (selectedNode?.kind === "group") {
		const visitGroup = (groupId: string): void => {
			if (invalidGroupParents.has(groupId)) return
			invalidGroupParents.add(groupId)
			for (const child of groups.get(groupId)?.children ?? [])
				if (child.kind === "group") visitGroup(child.id)
		}
		visitGroup(selectedNode.id)
	}
	const parentChoices = [
		...context.document.layers.map((layer) => ({
			key: `layer:${layer.id}`,
			label: `Layer · ${layer.name}`,
			disabled: Boolean(layer.hidden || layer.locked),
		})),
		...context.document.groups.map((group) => {
			const layerId = rows.find(
				({ key }) => key === `group:${group.id}`,
			)?.layerId
			const layer = context.document.layers.find(({ id }) => id === layerId)
			return {
				key: `group:${group.id}`,
				label: `Group · ${group.name}`,
				disabled:
					invalidGroupParents.has(group.id) ||
					Boolean(layer?.hidden || layer?.locked),
			}
		}),
	]
	const [moveParentChoice, setMoveParentChoice] = useState<Readonly<{
		rowKey: string
		parentKey: string
	}> | null>(null)
	const moveParentKey =
		moveParentChoice !== null &&
		moveParentChoice.rowKey === selectedHierarchyRow?.key
			? moveParentChoice.parentKey
			: (selectedHierarchyRow?.parentKey ?? "")
	const linkedArtboardChoices = useMemo(
		() =>
			(context.linkedArtboardResources ?? []).flatMap((resource) =>
				resource.document.artboards.map((artboard) => ({
					key: `${encodeURIComponent(resource.projectId)}/${encodeURIComponent(artboard.id)}`,
					resource,
					artboard,
				})),
			),
		[context.linkedArtboardResources],
	)
	const [linkedArtboardChoiceKey, setLinkedArtboardChoiceKey] = useState("")
	const linkedArtboardChoice =
		linkedArtboardChoices.find(({ key }) => key === linkedArtboardChoiceKey) ??
		linkedArtboardChoices[0]
	useEffect(() => {
		if (
			linkedArtboardChoiceKey !== "" &&
			linkedArtboardChoices.some(({ key }) => key === linkedArtboardChoiceKey)
		)
			return
		setLinkedArtboardChoiceKey(linkedArtboardChoices[0]?.key ?? "")
	}, [linkedArtboardChoiceKey, linkedArtboardChoices])
	return (
		<design-layers-tile>
			<strong>
				{context.document.objects.length} objects ·{" "}
				{context.document.blends?.length ?? 0} live blends
			</strong>
			<layer-toolbar role="toolbar" aria-label="Layer authoring">
				<button type="button" onClick={context.createLayer}>
					New layer
				</button>
			</layer-toolbar>
			<linked-artboard-placement aria-label="Place live linked artwork">
				<linked-artboard-heading>
					<span>
						<svg.Link aria-hidden="true" />
						<strong>Live linked artwork</strong>
					</span>
					<small>Place an artboard from another workspace design.</small>
				</linked-artboard-heading>
				<label>
					<span>Source artboard</span>
					<select
						aria-label="Linked artboard to place"
						value={linkedArtboardChoice?.key ?? ""}
						disabled={linkedArtboardChoice === undefined}
						onChange={(event) =>
							setLinkedArtboardChoiceKey(event.currentTarget.value)
						}
					>
						{linkedArtboardChoices.length === 0 ? (
							<option value="">No linked designs available</option>
						) : (
							linkedArtboardChoices.map(({ key, resource, artboard }) => (
								<option key={key} value={key}>
									{resource.projectId} · {artboard.name}
								</option>
							))
						)}
					</select>
				</label>
				<button
					type="button"
					disabled={
						linkedArtboardChoice === undefined ||
						context.placeLinkedArtboard === undefined
					}
					onClick={() => {
						if (linkedArtboardChoice === undefined) return
						context.placeLinkedArtboard?.(
							linkedArtboardChoice.resource,
							linkedArtboardChoice.artboard,
						)
					}}
				>
					<svg.Link aria-hidden="true" />
					Place live artboard
				</button>
			</linked-artboard-placement>
			{context.activeGroupScope.length === 0 ? null : (
				<layer-breadcrumb aria-label="Active group editing scope">
					<button type="button" onClick={() => context.setHierarchyScope([])}>
						Document
					</button>
					{activeScopeNames.map((group, index) => (
						<button
							key={group.id}
							type="button"
							aria-current={
								index === activeScopeNames.length - 1 ? "location" : undefined
							}
							onClick={() =>
								context.setHierarchyScope(
									context.activeGroupScope.slice(0, index + 1),
								)
							}
						>
							{group.name}
						</button>
					))}
				</layer-breadcrumb>
			)}
			<layer-tree role="tree" aria-label="Document layers">
				{rows.map((row, index) => {
					const branch = row.hasChildren
					const clippingPath =
						row.kind === "object" &&
						(effective.byObjectId.get(row.object!.id)?.clippingForGroupId ??
							null) !== null
					const selected =
						row.kind === "group"
							? context.selectedGroupId === row.key.slice("group:".length)
							: row.kind === "object"
								? context.selectedObjectIds.includes(row.object!.id) &&
									context.selectedGroupId === null
								: false
					const label = stateLabel(row)
					const rowLayer = context.document.layers.find(
						({ id }) => id === row.layerId,
					)
					const rowLayerIndex = context.document.layers.findIndex(
						({ id }) => id === row.layerId,
					)
					return (
						<layer-tree-row
							key={row.key}
							ref={(element: HTMLElement | null) => {
								if (element === null) rowRefs.current.delete(row.key)
								else rowRefs.current.set(row.key, element)
							}}
							role="treeitem"
							aria-level={row.depth}
							aria-expanded={branch ? expanded.has(row.key) : undefined}
							aria-selected={selected ? "true" : "false"}
							aria-current={
								row.kind === "layer" && row.layerId === context.activeLayerId
									? "true"
									: undefined
							}
							aria-label={`${row.name}. ${label}${pathRelated(row) ? "" : ". Outside the active editing scope"}`}
							tabIndex={focusedKey === row.key ? 0 : -1}
							data-layer-kind={row.kind}
							data-tree-key={row.key}
							data-clipping-path={clippingPath ? "true" : undefined}
							draggable={row.kind !== "layer"}
							data-dragging={draggedKey === row.key ? "true" : undefined}
							data-drop-target={dropKey === row.key ? "true" : undefined}
							data-active-scope={
								row.kind === "group" &&
								row.groupScope.length === context.activeGroupScope.length &&
								row.groupScope.every(
									(id, scopeIndex) =>
										context.activeGroupScope[scopeIndex] === id,
								)
									? "true"
									: undefined
							}
							data-out-of-scope={pathRelated(row) ? undefined : "true"}
							style={{ "--tree-depth": row.depth } as React.CSSProperties}
							onFocus={() => setFocusedKey(row.key)}
							onDragStart={(event: React.DragEvent<HTMLElement>) => {
								if (row.kind === "layer") return
								setDraggedKey(row.key)
								event.dataTransfer.effectAllowed = "move"
								event.dataTransfer.setData("text/plain", row.key)
							}}
							onDragOver={(event: React.DragEvent<HTMLElement>) => {
								if (draggedKey === null || draggedKey === row.key) return
								event.preventDefault()
								event.dataTransfer.dropEffect = "move"
								setDropKey(row.key)
							}}
							onDragLeave={() => {
								if (dropKey === row.key) setDropKey(null)
							}}
							onDrop={(event: React.DragEvent<HTMLElement>) => {
								event.preventDefault()
								const sourceKey =
									draggedKey ?? event.dataTransfer.getData("text/plain")
								if (sourceKey !== "" && sourceKey !== row.key)
									moveToRow(sourceKey, row)
								setDraggedKey(null)
								setDropKey(null)
							}}
							onDragEnd={() => {
								setDraggedKey(null)
								setDropKey(null)
							}}
							onClick={(event: React.MouseEvent<HTMLElement>) =>
								selectRow(row, event.shiftKey || event.metaKey || event.ctrlKey)
							}
							onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
								const previous = rows[index - 1]
								const next = rows[index + 1]
								if (event.key === "ArrowDown" && next !== undefined)
									focusRow(next.key)
								else if (event.key === "ArrowUp" && previous !== undefined)
									focusRow(previous.key)
								else if (event.key === "Home") focusRow(rows[0]!.key)
								else if (event.key === "End") focusRow(rows.at(-1)!.key)
								else if (event.key === "ArrowRight" && branch) {
									if (!expanded.has(row.key)) toggle(row.key)
									else if (next?.parentKey === row.key) focusRow(next.key)
								} else if (event.key === "ArrowLeft") {
									if (branch && expanded.has(row.key)) toggle(row.key)
									else if (row.parentKey !== null) focusRow(row.parentKey)
								} else if (event.key === "Enter" || event.key === " ")
									selectRow(
										row,
										event.shiftKey || event.metaKey || event.ctrlKey,
									)
								else return
								event.preventDefault()
							}}
						>
							{branch ? (
								<button
									type="button"
									data-disclosure
									aria-label={`${expanded.has(row.key) ? "Collapse" : "Expand"} ${row.name}`}
									onClick={(event) => {
										event.stopPropagation()
										toggle(row.key)
									}}
								>
									{expanded.has(row.key) ? (
										<ChevronDownIcon width={18} height={18} />
									) : (
										<ChevronRightIcon width={18} height={18} />
									)}
								</button>
							) : (
								<i data-disclosure-placeholder />
							)}
							<i
								data-layer-color
								style={{
									background: designLayerUiColorCss(
										rowLayer?.uiColor,
										rowLayerIndex,
									),
								}}
							/>
							<span>
								<b>{row.name}</b>
							</span>
							{row.kind === "group" ? (
								<button
									type="button"
									data-edit-scope
									aria-label={`Edit inside ${row.name}`}
									onClick={(event) => {
										event.stopPropagation()
										context.setHierarchyScope(row.groupScope)
									}}
								>
									Edit
								</button>
							) : row.kind === "layer" && rowLayer !== undefined ? (
								<layer-row-controls aria-label={`${rowLayer.name} state`}>
									<button
										type="button"
										data-layer-visibility
										aria-label={`${rowLayer.hidden ? "Show" : "Hide"} ${rowLayer.name}`}
										aria-pressed={!rowLayer.hidden}
										title={`${rowLayer.hidden ? "Show" : "Hide"} ${rowLayer.name}`}
										onClick={(event) => {
											event.stopPropagation()
											if (event.altKey)
												context.toggleOtherLayerVisibility(rowLayer.id)
											else
												context.setLayerVisibility(
													rowLayer.id,
													Boolean(rowLayer.hidden),
												)
										}}
										onKeyDown={(event) => event.stopPropagation()}
									>
										{rowLayer.hidden ? <svg.EyeClosed /> : <svg.EyeOpen />}
									</button>
									<button
										type="button"
										data-layer-lock
										aria-label={`${rowLayer.locked ? "Unlock" : "Lock"} ${rowLayer.name}`}
										aria-pressed={Boolean(rowLayer.locked)}
										title={`${rowLayer.locked ? "Unlock" : "Lock"} ${rowLayer.name}`}
										onClick={(event) => {
											event.stopPropagation()
											if (event.altKey)
												context.toggleOtherLayerLocks(rowLayer.id)
											else context.setLayerLocked(rowLayer.id, !rowLayer.locked)
										}}
										onKeyDown={(event) => event.stopPropagation()}
									>
										{rowLayer.locked ? <svg.LockClosed /> : null}
									</button>
								</layer-row-controls>
							) : row.object?.geometry.kind === "artboard-link" ? (
								<small data-live-link-badge title="Live linked artboard">
									<svg.Link aria-hidden="true" />
									Live
								</small>
							) : clippingPath ? (
								<small data-clipping-path-badge>Clip</small>
							) : null}
						</layer-tree-row>
					)
				})}
			</layer-tree>
			<layer-management aria-label={`Manage ${activeLayer.name}`}>
				<label>
					<span>Target layer name</span>
					<input
						value={activeLayerName}
						onInput={(event) => setActiveLayerName(event.currentTarget.value)}
						onBlur={commitActiveLayerName}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return
							commitActiveLayerName()
							event.currentTarget.blur()
						}}
					/>
				</label>
				<label>
					<span>Layer UI color</span>
					<select
						aria-label={`UI color for ${activeLayer.name}`}
						value={
							activeLayer.uiColor ??
							DESIGN_LAYER_UI_COLORS[
								activeLayerIndex % DESIGN_LAYER_UI_COLORS.length
							]
						}
						onChange={(event) =>
							context.setLayerUiColor(
								activeLayer.id,
								event.currentTarget.value as DesignLayerUiColor,
							)
						}
					>
						{DESIGN_LAYER_UI_COLORS.map((color) => (
							<option key={color} value={color}>
								{color[0]!.toUpperCase() + color.slice(1)}
							</option>
						))}
					</select>
				</label>
				<layer-actions
					role="toolbar"
					aria-label={`${activeLayer.name} actions`}
				>
					<button
						type="button"
						onClick={() => context.duplicateLayer(activeLayer.id)}
					>
						Duplicate
					</button>
					<button
						type="button"
						disabled={activeLayerIndex === context.document.layers.length - 1}
						onClick={() => context.reorderLayer(activeLayer.id, "up")}
					>
						Move up
					</button>
					<button
						type="button"
						disabled={activeLayerIndex === 0}
						onClick={() => context.reorderLayer(activeLayer.id, "down")}
					>
						Move down
					</button>
					<button
						type="button"
						disabled={context.document.layers.length === 1}
						title={
							context.document.layers.length === 1
								? "A document must keep at least one layer"
								: `Delete ${activeLayer.name} and its contents`
						}
						onClick={() => context.deleteLayer(activeLayer.id)}
					>
						Delete
					</button>
				</layer-actions>
			</layer-management>
			{selectedHierarchyRow === undefined || selectedNode === null ? null : (
				<layer-management aria-label={`Move ${selectedHierarchyRow.name}`}>
					<strong>Move {selectedHierarchyRow.name}</strong>
					<label>
						<span>Parent layer or group</span>
						<select
							aria-label={`Parent for ${selectedHierarchyRow.name}`}
							value={moveParentKey}
							onChange={(event) =>
								setMoveParentChoice({
									rowKey: selectedHierarchyRow.key,
									parentKey: event.currentTarget.value,
								})
							}
						>
							{parentChoices.map((choice) => (
								<option
									key={choice.key}
									value={choice.key}
									disabled={choice.disabled}
								>
									{choice.label}
								</option>
							))}
						</select>
					</label>
					<layer-actions
						role="toolbar"
						aria-label={`${selectedHierarchyRow.name} hierarchy`}
					>
						<button
							type="button"
							disabled={moveParentKey === ""}
							onClick={() => {
								const parent = parentForKey(moveParentKey)
								context.moveHierarchyNode(
									selectedNode,
									parent,
									childrenForParent(parent).length -
										(selectedHierarchyRow.parentKey === moveParentKey ? 1 : 0),
								)
							}}
						>
							Move to top
						</button>
						<button
							type="button"
							disabled={
								selectedParent === null ||
								selectedSiblingIndex < 0 ||
								selectedSiblingIndex === selectedSiblings.length - 1
							}
							onClick={() =>
								context.moveHierarchyNode(
									selectedNode,
									selectedParent!,
									selectedSiblingIndex + 1,
								)
							}
						>
							Move up
						</button>
						<button
							type="button"
							disabled={selectedParent === null || selectedSiblingIndex <= 0}
							onClick={() =>
								context.moveHierarchyNode(
									selectedNode,
									selectedParent!,
									selectedSiblingIndex - 1,
								)
							}
						>
							Move down
						</button>
					</layer-actions>
				</layer-management>
			)}
			{(context.document.blends?.length ?? 0) === 0 ? null : (
				<design-live-blends aria-label="Live blends">
					<strong>Live blends</strong>
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
				</design-live-blends>
			)}
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
			<guide-global-controls role="group" aria-label="All guides">
				<button
					type="button"
					disabled={context.document.guides.length === 0}
					aria-label={
						context.guidesVisible ? "Hide all guides" : "Show all guides"
					}
					aria-pressed={!context.guidesVisible}
					title={
						context.document.guides.length === 0
							? "Create a guide before changing guide visibility."
							: context.guidesVisible
								? "Hide all guides"
								: "Show all guides"
					}
					onClick={() => context.setGuidesVisible(!context.guidesVisible)}
				>
					{context.guidesVisible ? <svg.EyeOpen /> : <svg.EyeClosed />}
				</button>
				{(() => {
					const allLocked =
						context.document.guides.length > 0 &&
						context.document.guides.every((guide) => guide.locked)
					const someLocked = context.document.guides.some(
						(guide) => guide.locked,
					)
					const pressed = allLocked ? true : someLocked ? "mixed" : false
					const label = allLocked ? "Unlock all guides" : "Lock all guides"
					return (
						<button
							type="button"
							disabled={context.document.guides.length === 0}
							aria-label={label}
							aria-pressed={pressed}
							title={
								context.document.guides.length === 0
									? "Create a guide before changing guide locks."
									: label
							}
							onClick={() => context.setAllGuidesLocked(!allLocked)}
						>
							{allLocked ? <svg.LockClosed /> : null}
						</button>
					)
				})()}
			</guide-global-controls>
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
								aria-pressed={Boolean(guide.locked)}
								title={guide.locked ? "Unlock guide" : "Lock guide"}
								onClick={() => context.toggleGuideLock(guide.id)}
							>
								{guide.locked ? <svg.LockClosed /> : null}
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
					<TooltipButton
						key={id}
						label={definition.label}
						description={definition.description}
						aria-pressed={context.tool === id}
						disabled={disabled}
						disabledReason={
							disabled
								? (context.textToolsDisabledReason ?? undefined)
								: undefined
						}
						placement="bottom"
						shortcut={{
							ariaKeyShortcuts: definition.key,
							keycaps: [definition.key],
						}}
						onClick={() => context.selectTool(id)}
					>
						<svg.Icon aria-hidden="true" />
					</TooltipButton>
				)
			})}
		</design-tools-tile>
	)
}

type CompactExportDiagnostic = Readonly<{
	code: string
	message: string
	severity: string
	stage?: string
}>

function CompactExportDiagnostics({
	diagnostics,
	label,
	live = false,
}: Readonly<{
	diagnostics: readonly CompactExportDiagnostic[]
	label: string
	live?: boolean
}>) {
	const groups = new Map<
		string,
		Readonly<{ diagnostic: CompactExportDiagnostic; count: number }>
	>()
	for (const diagnostic of diagnostics) {
		const key = `${diagnostic.severity}\0${diagnostic.stage ?? ""}\0${diagnostic.message}`
		const group = groups.get(key)
		groups.set(key, {
			diagnostic,
			count: (group?.count ?? 0) + 1,
		})
	}
	const errors = diagnostics.filter(
		({ severity }) => severity === "error",
	).length
	const warnings = diagnostics.filter(
		({ severity }) => severity === "warning",
	).length
	return (
		<compact-export-diagnostics>
			<details
				data-export-preflight
				data-decision={errors > 0 ? "blocked" : "ready"}
				open={errors > 0}
				aria-live={live ? "polite" : undefined}
			>
				<summary>
					<strong>{label}</strong>
					<span>
						{errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null}
						{errors > 0 && warnings > 0 ? " · " : null}
						{warnings > 0
							? `${warnings} warning${warnings === 1 ? "" : "s"}`
							: errors === 0
								? `${diagnostics.length} notice${diagnostics.length === 1 ? "" : "s"}`
								: null}
					</span>
				</summary>
				<ul aria-label={`${label} details`}>
					{[...groups.values()].map(({ count, diagnostic }) => (
						<li
							key={`${diagnostic.code}:${diagnostic.stage ?? ""}:${diagnostic.message}`}
							data-severity={diagnostic.severity}
						>
							<strong>{diagnostic.stage ?? diagnostic.severity}</strong>
							<span>{diagnostic.message}</span>
							{count === 1 ? null : <small>Applies to {count} items</small>}
						</li>
					))}
				</ul>
			</details>
		</compact-export-diagnostics>
	)
}

function DesignExportTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	const exportDocument = context.exportDocumentSnapshot ?? context.document
	const [format, setFormat] = useState<"pdf" | "svg" | "png">("pdf")
	const [previewEnabled, setPreviewEnabled] = useState(false)
	const [svgPreviewEnabled, setSvgPreviewEnabled] = useState(false)
	const [pngPreviewEnabled, setPngPreviewEnabled] = useState(false)
	const [pngScale, setPngScale] = useState(1)
	const [pngBackground, setPngBackground] = useState("artboard")
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
		const valid = exportDocument.artboards
			.filter(({ id }) => selectedArtboardIds.includes(id))
			.map(({ id }) => id)
		return valid.length === 0 ? [context.activeArtboard.id] : valid
	}, [context.activeArtboard.id, exportDocument.artboards, selectedArtboardIds])
	const startId = exportDocument.artboards.some(({ id }) => id === rangeStartId)
		? rangeStartId
		: context.activeArtboard.id
	const endId = exportDocument.artboards.some(({ id }) => id === rangeEndId)
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
	const pageCount = resolvePdfArtboards(exportDocument, target).length
	const preflightPreferences = useMemo<ExportPreflightPreferences>(
		() => ({
			enabledLints: checkOutsideArtwork ? [ARTWORK_OUTSIDE_ARTBOARDS_LINT] : [],
		}),
		[checkOutsideArtwork],
	)
	const preflight = useMemo(
		() =>
			preflightPdfExport(
				exportDocument,
				target,
				preflightPreferences,
				context.textService,
			),
		[
			exportDocument,
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
		for (const artboard of exportDocument.artboards)
			groups.set(artboard.id, {
				label: artboard.name,
				diagnostics: [],
			})
		for (const diagnostic of preflight.diagnostics) {
			const artboard = exportDocument.artboards.find(
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
	}, [exportDocument.artboards, preflight.diagnostics])
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
		() => preflightSvgExport(exportDocument, svgTarget),
		[exportDocument, svgTarget],
	)
	const pngRequest = useMemo<PngExportRequest>(
		() => ({
			scope: target.scope,
			scale: pngScale,
			...(pngBackground === "artboard"
				? {}
				: {
						background:
							pngBackground === "transparent"
								? ({ kind: "transparent" } as const)
								: {
										kind: "color",
										r: Number.parseInt(pngBackground.slice(1, 3), 16),
										g: Number.parseInt(pngBackground.slice(3, 5), 16),
										b: Number.parseInt(pngBackground.slice(5, 7), 16),
									},
					}),
		}),
		[pngBackground, pngScale, target.scope],
	)
	const pngPreflight = useMemo(
		() => preflightPngExport(exportDocument, pngRequest),
		[exportDocument, pngRequest],
	)
	return (
		<design-export-tile>
			<export-heading>
				<strong>Export</strong>
				<span>Prepare, inspect, and save the current design.</span>
			</export-heading>
			<TileButtonGroup aria-label="Export format" compact>
				{(["pdf", "svg", "png"] as const).map((id) => (
					<TileButton
						key={id}
						compact
						aria-pressed={format === id}
						aria-controls={format === id ? `export-${id}-panel` : undefined}
						onClick={() => setFormat(id)}
					>
						{id.toUpperCase()}
					</TileButton>
				))}
			</TileButtonGroup>
			{format !== "pdf" ? null : (
				<export-format-panel
					id="export-pdf-panel"
					role="region"
					aria-label="PDF export options"
				>
					<export-format-heading>
						<strong>Portable Document Format</strong>
						<span>
							{pageCount} page{pageCount === 1 ? "" : "s"}
						</span>
					</export-format-heading>
					<p>
						RGB and CMYK vector fills and strokes are preserved through
						mondrian.pdf.
					</p>
					<TileSelect
						label="Pages"
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
					</TileSelect>
					{scope !== "selected" ? null : (
						<fieldset data-export-selection>
							<legend>Selected artboards</legend>
							{exportDocument.artboards.map((artboard) => (
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
									onChange={(event) =>
										setRangeStartId(event.currentTarget.value)
									}
								>
									{exportDocument.artboards.map((artboard) => (
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
									{exportDocument.artboards.map((artboard) => (
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
									{preflight.summary.errors} errors ·{" "}
									{preflight.summary.warnings} warnings ·{" "}
									{preflight.summary.infos} notices
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
													<TileButton
														compact
														type="button"
														onClick={() => followDiagnostic(diagnostic)}
													>
														Select object
													</TileButton>
												) : diagnostic.action?.kind === "activate-artboard" &&
												  exportDocument.artboards.some(
														({ id }) => id === diagnostic.artboardId,
												  ) ? (
													<TileButton
														compact
														type="button"
														onClick={() => followDiagnostic(diagnostic)}
													>
														Show artboard
													</TileButton>
												) : null}
											</li>
										))}
									</ul>
								</section>
							))}
						</details>
					)}
					<TileButton
						type="button"
						tone="primary"
						style={{ width: "100%" }}
						disabled={!canExport}
						onClick={() => context.exportDocument(target, preflightPreferences)}
					>
						Export {pageCount} page{pageCount === 1 ? "" : "s"} as PDF
					</TileButton>
					<label data-live-preview>
						<input
							type="checkbox"
							checked={previewEnabled}
							onChange={(event) =>
								setPreviewEnabled(event.currentTarget.checked)
							}
						/>
						<span>Live PDF proof</span>
					</label>
					{previewEnabled ? (
						<PdfPreview
							document={exportDocument}
							target={target}
							preflightPreferences={preflightPreferences}
							{...(context.textService === undefined
								? {}
								: { textService: context.textService })}
						/>
					) : null}
				</export-format-panel>
			)}
			{format !== "svg" ? null : (
				<export-format-panel
					id="export-svg-panel"
					role="region"
					aria-label="SVG export options"
				>
					<export-format-heading>
						<strong>Scalable Vector Graphics</strong>
						<span>Active artboard</span>
					</export-format-heading>
					<p>
						Export or import the supported vector subset through the same
						headless SVG pipeline used by preview and the CLI.
					</p>
					{svgPreflight.diagnostics.length === 0 ? null : (
						<CompactExportDiagnostics
							diagnostics={svgPreflight.diagnostics}
							label="SVG preflight"
						/>
					)}
					<TileButton
						type="button"
						tone="primary"
						style={{ width: "100%" }}
						disabled={svgPreflight.decision === "blocked"}
						onClick={() => context.exportSvgDocument(svgTarget)}
					>
						Export active artboard as SVG
					</TileButton>
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
						<CompactExportDiagnostics
							diagnostics={svgImportDiagnostics}
							label="Import feedback"
							live
						/>
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
						<SvgPreview document={exportDocument} target={svgTarget} />
					) : null}
				</export-format-panel>
			)}
			{format !== "png" ? null : (
				<export-format-panel
					id="export-png-panel"
					role="region"
					aria-label="PNG export options"
				>
					<export-format-heading>
						<strong>Portable Network Graphics</strong>
						<span>
							{pngPreflight.artboards.length} artboard
							{pngPreflight.artboards.length === 1 ? "" : "s"}
						</span>
					</export-format-heading>
					<p>
						Rasterize the chosen artboard scope through the same deterministic,
						headless pipeline used by the CLI and live proof.
					</p>
					<export-field-row>
						<TileSelect
							label="Scale"
							value={pngScale}
							onChange={(event) =>
								setPngScale(Number(event.currentTarget.value))
							}
						>
							<option value={1}>1×</option>
							<option value={2}>2×</option>
							<option value={4}>4×</option>
						</TileSelect>
						<TileSelect
							label="Background"
							value={pngBackground}
							onChange={(event) => setPngBackground(event.currentTarget.value)}
						>
							<option value="artboard">Artboard setting</option>
							<option value="transparent">Transparent</option>
							<option value="#ffffff">White</option>
							<option value="#000000">Black</option>
						</TileSelect>
					</export-field-row>
					{pngPreflight.diagnostics.length === 0 ? null : (
						<CompactExportDiagnostics
							diagnostics={pngPreflight.diagnostics}
							label="PNG preflight"
						/>
					)}
					<TileButton
						type="button"
						tone="primary"
						style={{ width: "100%" }}
						disabled={pngPreflight.decision === "blocked"}
						onClick={() => context.exportPngDocument(pngRequest)}
					>
						Export {pngPreflight.artboards.length} artboard
						{pngPreflight.artboards.length === 1 ? "" : "s"} as PNG
					</TileButton>
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
						<PngPreview document={exportDocument} request={pngRequest} />
					) : null}
				</export-format-panel>
			)}
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
	const alignmentTarget = context.alignmentTarget
	const keyObject =
		context.keyObjectId === null
			? null
			: (context.document.objects.find(
					({ id }) => id === context.keyObjectId,
				) ?? null)
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
					<span aria-live="polite">
						{keyObject === null
							? selectionCountLabel(context)
							: `Key: ${keyObject.name}`}
					</span>
				</arrangement-heading>
				<TileSelect
					label="Align to"
					value={alignmentTarget}
					disabled={transformDisabledReason !== null}
					onChange={(event) =>
						context.setAlignmentTarget(
							event.currentTarget.value as DesignAlignmentTarget,
						)
					}
				>
					<option value="selection">Selection</option>
					<option value="key-object" disabled={keyObject === null}>
						{keyObject === null
							? "Key object (none)"
							: `Key object: ${keyObject.name}`}
					</option>
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
									context.keyObjectId ?? undefined,
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
	if (object?.geometry.kind === "artboard-link") {
		return [
			{
				disabled: true,
				label: "Local X",
				value: 0,
			},
			{
				disabled: true,
				label: "Local Y",
				value: 0,
			},
			{
				disabled: true,
				label: "Width",
				value: object.geometry.width,
			},
			{
				disabled: true,
				label: "Height",
				value: object.geometry.height,
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
					: object?.geometry.kind === "artboard-link"
						? "Linked artboard"
						: "Object geometry"
	const linkedGeometry =
		object?.geometry.kind === "artboard-link" ? object.geometry : null
	const linkedSource =
		linkedGeometry !== null
			? context.linkedArtboardResources?.find(
					({ projectId }) => projectId === linkedGeometry.projectId,
				)
			: undefined
	const linkedSourceArtboard =
		linkedGeometry !== null
			? linkedSource?.document.artboards.find(
					({ id }) => id === linkedGeometry.artboardId,
				)
			: undefined
	const cornerControls = context.cornerProfileControls ?? null
	return (
		<design-object-tile>
			<object-selection-summary role="status">
				{objectSelectionSummary(context, object)}
			</object-selection-summary>
			{object?.geometry.kind === "artboard-link" ? (
				<object-live-link
					data-source-available={
						linkedSourceArtboard === undefined ? "false" : "true"
					}
				>
					<object-live-link-heading>
						<span>
							<svg.Link aria-hidden="true" />
							<strong>Live linked artboard</strong>
						</span>
						<small>
							{linkedSourceArtboard === undefined
								? "Source unavailable"
								: "Live"}
						</small>
					</object-live-link-heading>
					<dl>
						<object-live-link-source>
							<dt>Design</dt>
							<dd>{object.geometry.projectId}</dd>
						</object-live-link-source>
						<object-live-link-source>
							<dt>Artboard</dt>
							<dd>
								{linkedSourceArtboard?.name ?? object.geometry.artboardId}
							</dd>
						</object-live-link-source>
					</dl>
					<p>
						Updates with its source and transforms or snaps as one group-like
						object.
					</p>
				</object-live-link>
			) : null}
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
						: object?.geometry.kind === "artboard-link"
							? `Portable live reference to ${object.geometry.projectId}/${object.geometry.artboardId}; transform it as one object.`
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
			{cornerControls === null ? null : (
				<fieldset
					aria-label={`Corner profile controls for ${cornerControls.count} selected corner${cornerControls.count === 1 ? "" : "s"}`}
					data-corner-profile-controls
				>
					<legend>Corner profiles</legend>
					<small>
						Editing {cornerControls.count} hard corner
						{cornerControls.count === 1 ? "" : "s"}
					</small>
					<label>
						Profile
						<select
							aria-label="Corner profile"
							value={cornerControls.profile}
							onChange={(event) => {
								const profile = event.currentTarget.value as
									| "sharp"
									| "circular"
									| "squircle"
								context.setCornerProfiles(
									profile,
									cornerControls.amount > 0 ? cornerControls.amount : 12,
								)
							}}
						>
							<option value="sharp">Sharp / right angle</option>
							<option value="circular">Circular</option>
							<option value="squircle">Squircle</option>
						</select>
					</label>
					<label>
						Amount
						<input
							type="number"
							aria-label="Corner amount in document geometry units"
							min={0}
							step={1}
							value={cornerControls.amount}
							disabled={cornerControls.profile === "sharp"}
							{...(cornerControls.amountWarning === null
								? {}
								: {
										"aria-describedby": "corner-amount-clamp-warning",
										"data-corner-amount-clamped": true,
									})}
							onChange={(event) =>
								context.setCornerProfiles(
									cornerControls.profile,
									event.currentTarget.valueAsNumber,
								)
							}
						/>
					</label>
					{cornerControls.amountWarning === null ? null : (
						<small
							id="corner-amount-clamp-warning"
							role="status"
							data-corner-amount-warning
						>
							{cornerControls.amountWarning}
						</small>
					)}
				</fieldset>
			)}
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
					"Converts live shape parameters or corner profiles to ordinary editable cubic path geometry."}
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
					{object?.locked ? <svg.LockClosed /> : null}
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
	) => {
		const value = style[property]
		const placeholder = propertyPlaceholder(value)
		return (
			<label data-stroke-field>
				<span>{label}</span>
				<NumericInput
					value={typeof value === "number" ? value : null}
					step="any"
					arrowStep={1}
					fallbackValue={minimum ?? 0}
					{...(minimum === undefined ? {} : { min: minimum })}
					{...(placeholder === undefined ? {} : { placeholder })}
					aria-label={`Stroke ${label.toLowerCase()}`}
					aria-describedby="stroke-properties-eligibility"
					disabled={disabled}
					onCommit={(nextValue) =>
						context.applyStrokeProperties({ [property]: nextValue })
					}
				/>
			</label>
		)
	}
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
