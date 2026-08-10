import {
	ActionHotbar,
	assignPaletteCommandToHotbar,
	CommandPalette,
	createRegistryDefaultLayout,
	createTileRegistry,
	isCommandPaletteKeyboardEvent,
	IS_MAC_LIKE,
	MOD_KEY_LABEL,
	parseHotbarSlots,
	TileButton,
	TileCheckbox,
	TileNumericField,
	TileSelect,
	TileTextField,
	tileRegistryCommands,
	TilingWorkspace,
	type HotbarSlots,
	type PaletteCommand,
	type TileCommandRequest,
	type TileRegistration,
	type TilingWorkspaceStatus,
} from "./shared-editor.ts"
import {
	createElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

import {
	DEFAULT_SPRITE_HOTBAR_SLOTS,
	SPRITE_HOTBAR_STORAGE_KEY,
} from "./action-hotbar.ts"
import {
	readSpriteAppearance,
	SPRITE_APPEARANCE_STORAGE_KEY,
	spriteAppearanceIsLight,
	type SpriteAppearance,
} from "./appearance.ts"
import type { SpriteEditorBrowserOptions } from "./browser-api.ts"
import {
	exportFramePng,
	exportProjectJson,
	exportSpriteSheet,
	importPngToPalette,
} from "./export.ts"
import {
	blankRows,
	celPixels,
	compositeFrame,
	floodFill,
	linePoints,
	nextIdentifier,
	paintPoints,
	rectanglePoints,
	setCelPixels,
	TRANSPARENT_PIXEL,
	type SpriteColor,
	type SpriteFrame,
	type SpriteLayer,
	type SpritePlaybackDirection,
	type SpritePoint,
	type SpriteProject,
	type SpriteTool,
} from "./model.ts"
import "./SpriteApplication.css"

const TOOL_INFO: Readonly<
	Record<SpriteTool, Readonly<{ label: string; key: string; glyph: string }>>
> = {
	pencil: { label: "Pencil", key: "B", glyph: "✎" },
	eraser: { label: "Eraser", key: "E", glyph: "◇" },
	fill: { label: "Fill", key: "G", glyph: "▰" },
	line: { label: "Line", key: "L", glyph: "╱" },
	rectangle: { label: "Rectangle", key: "U", glyph: "□" },
	eyedropper: { label: "Eyedropper", key: "I", glyph: "⌁" },
}

type SaveState = "saved" | "dirty" | "saving" | "offline" | "error"
type SpriteTileKind =
	| "tools"
	| "palette"
	| "layers"
	| "preview"
	| "project"
	| "frame"
	| "animation"
	| "export"

interface SpriteTileContext {
	readonly project: SpriteProject
	readonly activeFrame: SpriteFrame
	readonly activeLayer: SpriteLayer
	readonly tool: SpriteTool
	readonly brushSize: number
	readonly primaryColor: number
	readonly secondaryColor: number
	readonly symmetryX: boolean
	readonly symmetryY: boolean
	readonly filledRectangle: boolean
	readonly playing: boolean
	readonly lightAppearance: boolean
	readonly saveState: SaveState
	readonly exportScale: number
	readonly exportColumns: number
	readonly setTool: (tool: SpriteTool) => void
	readonly setBrushSize: (size: number) => void
	readonly setPrimaryColor: (index: number) => void
	readonly setSecondaryColor: (index: number) => void
	readonly setSymmetryX: (active: boolean) => void
	readonly setSymmetryY: (active: boolean) => void
	readonly setFilledRectangle: (active: boolean) => void
	readonly setTitle: (title: string) => void
	readonly updateColor: (index: number, color: Partial<SpriteColor>) => void
	readonly addColor: () => void
	readonly removeColor: () => void
	readonly selectLayer: (id: string) => void
	readonly updateLayer: (layer: Partial<SpriteLayer>) => void
	readonly addLayer: (duplicate: boolean) => void
	readonly deleteLayer: () => void
	readonly updateFrame: (frame: Partial<SpriteFrame>) => void
	readonly addFrame: (duplicate: boolean) => void
	readonly deleteFrame: () => void
	readonly togglePlayback: () => void
	readonly addTag: () => void
	readonly updateTagDirection: (direction: SpritePlaybackDirection) => void
	readonly save: () => void
	readonly importPng: (file: File) => void
	readonly exportFrame: () => void
	readonly exportSheet: () => void
	readonly exportProject: () => void
	readonly setExportScale: (scale: number) => void
	readonly setExportColumns: (columns: number) => void
}

function SpriteTile({
	context,
	kind,
}: Readonly<{ context: SpriteTileContext; kind: SpriteTileKind }>) {
	const activeColor = context.project.palette[context.primaryColor]
	if (kind === "tools")
		return (
			<div className="sprite-tile-content">
				<div className="tool-grid">
					{(Object.keys(TOOL_INFO) as SpriteTool[]).map((tool) => (
						<TileButton
							key={tool}
							compact
							data-active={context.tool === tool || undefined}
							onClick={() => context.setTool(tool)}
							title={`${TOOL_INFO[tool].label} (${TOOL_INFO[tool].key})`}
						>
							<span aria-hidden="true">{TOOL_INFO[tool].glyph}</span>
							{TOOL_INFO[tool].label}
							<kbd>{TOOL_INFO[tool].key}</kbd>
						</TileButton>
					))}
				</div>
				<TileNumericField
					label="Brush size"
					min={1}
					max={8}
					value={context.brushSize}
					onCommit={context.setBrushSize}
				/>
				<div className="check-row">
					<TileCheckbox
						label="Mirror X"
						checked={context.symmetryX}
						onChange={(event) =>
							context.setSymmetryX(event.currentTarget.checked)
						}
					/>
					<TileCheckbox
						label="Mirror Y"
						checked={context.symmetryY}
						onChange={(event) =>
							context.setSymmetryY(event.currentTarget.checked)
						}
					/>
				</div>
				<TileCheckbox
					label="Filled rectangles"
					checked={context.filledRectangle}
					onChange={(event) =>
						context.setFilledRectangle(event.currentTarget.checked)
					}
				/>
			</div>
		)
	if (kind === "palette")
		return (
			<div className="sprite-tile-content palette-content">
				<div className="paint-pair" title="Primary and secondary paint">
					<button
						type="button"
						style={{
							background: context.project.palette[
								context.secondaryColor
							]?.value.slice(0, 7),
						}}
						aria-label="Secondary color"
						onClick={() => context.setPrimaryColor(context.secondaryColor)}
					/>
					<button
						type="button"
						style={{ background: activeColor?.value.slice(0, 7) }}
						aria-label="Primary color"
					/>
					<button
						type="button"
						className="swap-paint"
						aria-label="Swap colors"
						onClick={() => {
							const primary = context.primaryColor
							context.setPrimaryColor(context.secondaryColor)
							context.setSecondaryColor(primary)
						}}
					>
						⇄
					</button>
				</div>
				<div
					className="swatch-grid"
					role="listbox"
					aria-label="Indexed palette"
				>
					{context.project.palette.map((color, index) => (
						<button
							key={color.id}
							type="button"
							role="option"
							aria-selected={index === context.primaryColor}
							data-secondary={index === context.secondaryColor || undefined}
							style={{ background: color.value.slice(0, 7) }}
							title={`${index}: ${color.name}\nLeft click: primary · Right click: secondary`}
							onClick={() => context.setPrimaryColor(index)}
							onContextMenu={(event) => {
								event.preventDefault()
								context.setSecondaryColor(index)
							}}
						>
							<span>{index}</span>
						</button>
					))}
				</div>
				{activeColor === undefined ? null : (
					<>
						<TileTextField
							label="Color name"
							value={activeColor.name}
							onChange={(event) =>
								context.updateColor(context.primaryColor, {
									name: event.currentTarget.value,
								})
							}
						/>
						<label className="color-field">
							<span>Color</span>
							<input
								type="color"
								value={activeColor.value.slice(0, 7)}
								onChange={(event) =>
									context.updateColor(context.primaryColor, {
										value: `${event.currentTarget.value}ff`,
									})
								}
							/>
							<code>{activeColor.value}</code>
						</label>
					</>
				)}
				<div className="button-row">
					<TileButton compact onClick={context.addColor}>
						Add color
					</TileButton>
					<TileButton
						compact
						disabled={context.project.palette.length <= 1}
						onClick={context.removeColor}
					>
						Remove
					</TileButton>
				</div>
			</div>
		)
	if (kind === "layers")
		return (
			<div className="sprite-tile-content">
				<div className="layer-list">
					{[...context.project.layers].reverse().map((layer) => (
						<button
							key={layer.id}
							type="button"
							data-active={layer.id === context.activeLayer.id || undefined}
							onClick={() => context.selectLayer(layer.id)}
						>
							<span>{layer.visible ? "◉" : "○"}</span>
							<strong>{layer.name}</strong>
							<small>
								{layer.locked
									? "locked"
									: `${Math.round(layer.opacity * 100)}%`}
							</small>
						</button>
					))}
				</div>
				<TileTextField
					label="Layer name"
					value={context.activeLayer.name}
					onChange={(event) =>
						context.updateLayer({ name: event.currentTarget.value })
					}
				/>
				<TileNumericField
					label="Opacity"
					min={0}
					max={100}
					value={Math.round(context.activeLayer.opacity * 100)}
					onCommit={(value) => context.updateLayer({ opacity: value / 100 })}
				/>
				<div className="check-row">
					<TileCheckbox
						label="Visible"
						checked={context.activeLayer.visible}
						onChange={(event) =>
							context.updateLayer({ visible: event.currentTarget.checked })
						}
					/>
					<TileCheckbox
						label="Locked"
						checked={context.activeLayer.locked}
						onChange={(event) =>
							context.updateLayer({ locked: event.currentTarget.checked })
						}
					/>
				</div>
				<div className="button-row">
					<TileButton compact onClick={() => context.addLayer(false)}>
						New
					</TileButton>
					<TileButton compact onClick={() => context.addLayer(true)}>
						Duplicate
					</TileButton>
					<TileButton
						compact
						disabled={context.project.layers.length <= 1}
						onClick={context.deleteLayer}
					>
						Delete
					</TileButton>
				</div>
			</div>
		)
	if (kind === "preview")
		return (
			<div className="sprite-tile-content preview-content">
				<FramePreview
					project={context.project}
					frameId={context.activeFrame.id}
					lightAppearance={context.lightAppearance}
				/>
				<div>
					<strong>{context.activeFrame.name}</strong>
					<span>
						{context.project.width}×{context.project.height} ·{" "}
						{context.activeFrame.duration} ms
					</span>
				</div>
				<TileButton tone="primary" onClick={context.togglePlayback}>
					{context.playing ? "Pause preview" : "Play animation"}
				</TileButton>
			</div>
		)
	if (kind === "project")
		return (
			<div className="sprite-tile-content">
				<TileTextField
					label="Project title"
					value={context.project.title}
					onChange={(event) => context.setTitle(event.currentTarget.value)}
				/>
				<div className="metric-grid">
					<span>
						<strong>
							{context.project.width} × {context.project.height}
						</strong>
						<small>Canvas</small>
					</span>
					<span>
						<strong>{context.project.frames.length}</strong>
						<small>Frames</small>
					</span>
					<span>
						<strong>{context.project.layers.length}</strong>
						<small>Layers</small>
					</span>
					<span>
						<strong>{context.project.palette.length}</strong>
						<small>Colors</small>
					</span>
				</div>
				<TileButton
					tone="primary"
					onClick={context.save}
					disabled={context.saveState === "saving"}
				>
					{context.saveState === "saving" ? "Saving…" : "Save source"}
				</TileButton>
				<p className="tile-note">
					Edits are stored as readable palette, layer, frame, tag, and cel
					source files.
				</p>
			</div>
		)
	if (kind === "frame")
		return (
			<div className="sprite-tile-content">
				<TileTextField
					label="Frame name"
					value={context.activeFrame.name}
					onChange={(event) =>
						context.updateFrame({ name: event.currentTarget.value })
					}
				/>
				<TileNumericField
					label="Duration (ms)"
					min={16}
					max={60_000}
					value={context.activeFrame.duration}
					onCommit={(duration) => context.updateFrame({ duration })}
				/>
				<div className="button-row">
					<TileButton compact onClick={() => context.addFrame(false)}>
						New blank
					</TileButton>
					<TileButton compact onClick={() => context.addFrame(true)}>
						Duplicate
					</TileButton>
					<TileButton
						compact
						disabled={context.project.frames.length <= 1}
						onClick={context.deleteFrame}
					>
						Delete
					</TileButton>
				</div>
			</div>
		)
	if (kind === "animation") {
		const tag = context.project.tags[0]
		return (
			<div className="sprite-tile-content">
				<div className="metric-grid">
					<span>
						<strong>
							{Math.round(
								context.project.frames.reduce(
									(sum, frame) => sum + frame.duration,
									0,
								) / 10,
							) / 100}
							s
						</strong>
						<small>Loop length</small>
					</span>
					<span>
						<strong>{context.project.tags.length}</strong>
						<small>Tags</small>
					</span>
				</div>
				{tag === undefined ? (
					<TileButton onClick={context.addTag}>Tag full loop</TileButton>
				) : (
					<>
						<p className="tag-chip">
							<span />
							{tag.name}
							<small>
								{tag.fromFrameId} → {tag.toFrameId}
							</small>
						</p>
						<TileSelect
							label="Direction"
							value={tag.direction}
							onChange={(event) =>
								context.updateTagDirection(
									event.currentTarget.value as SpritePlaybackDirection,
								)
							}
						>
							<option value="forward">Forward</option>
							<option value="reverse">Reverse</option>
							<option value="ping-pong">Ping-pong</option>
						</TileSelect>
					</>
				)}
			</div>
		)
	}
	return (
		<div className="sprite-tile-content">
			<TileNumericField
				label="Pixel scale"
				min={1}
				max={16}
				value={context.exportScale}
				onCommit={context.setExportScale}
			/>
			<TileNumericField
				label="Sheet columns"
				min={1}
				max={context.project.frames.length}
				value={context.exportColumns}
				onCommit={context.setExportColumns}
			/>
			<TileButton tone="primary" onClick={context.exportSheet}>
				Sprite sheet + JSON
			</TileButton>
			<TileButton onClick={context.exportFrame}>Current frame PNG</TileButton>
			<TileButton onClick={context.exportProject}>
				Portable project JSON
			</TileButton>
			<label className="file-button">
				Import PNG into cel
				<input
					type="file"
					accept="image/png"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0]
						if (file !== undefined) context.importPng(file)
						event.currentTarget.value = ""
					}}
				/>
			</label>
		</div>
	)
}

const TILE_REGISTRATIONS = [
	{
		kind: "palette",
		name: "Palette",
		description: "Choose and edit indexed sprite colors.",
		defaultFill: true,
		defaultPlacement: { column: 1, fill: true },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "palette" }),
	},
	{
		kind: "tools",
		name: "Pixel tools",
		description: "Draw, fill, sample, and mirror pixels.",
		defaultPlacement: { column: 2 },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "tools" }),
	},
	{
		kind: "layers",
		name: "Layers",
		description: "Organize and isolate animation artwork.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "layers" }),
	},
	{
		kind: "preview",
		name: "Live preview",
		description: "Preview the current frame and animation.",
		defaultPlacement: { column: 3 },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "preview" }),
	},
	{
		kind: "project",
		name: "Project",
		description: "Inspect and save the source project.",
		defaultFill: true,
		defaultPlacement: { column: 3, fill: true },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "project" }),
	},
	{
		kind: "frame",
		name: "Frame",
		description: "Edit the selected animation frame.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "frame" }),
	},
	{
		kind: "animation",
		name: "Animation",
		description: "Control loop tags and playback direction.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "animation" }),
	},
	{
		kind: "export",
		name: "Export",
		description: "Export game-ready PNG and sprite-sheet assets.",
		defaultFill: true,
		defaultPlacement: { column: 4, fill: true },
		render: ({ context }) =>
			createElement(SpriteTile, { context, kind: "export" }),
	},
] as const satisfies readonly TileRegistration<
	SpriteTileKind,
	SpriteTileContext
>[]

const SPRITE_TILE_REGISTRY = createTileRegistry<
	SpriteTileKind,
	SpriteTileContext
>(TILE_REGISTRATIONS)
const DEFAULT_LAYOUT = createRegistryDefaultLayout(SPRITE_TILE_REGISTRY)

function rgbaCanvas(
	canvas: HTMLCanvasElement,
	project: SpriteProject,
	frameId: string,
	pixelSize: number,
	onionSkin: boolean,
	lightAppearance: boolean,
): void {
	const ratio = window.devicePixelRatio || 1
	const displayWidth = project.width * pixelSize
	const displayHeight = project.height * pixelSize
	canvas.width = Math.round(displayWidth * ratio)
	canvas.height = Math.round(displayHeight * ratio)
	canvas.style.width = `${displayWidth}px`
	canvas.style.height = `${displayHeight}px`
	const context = canvas.getContext("2d")
	if (context === null) return
	context.scale(ratio, ratio)
	for (let y = 0; y < project.height; y += 1)
		for (let x = 0; x < project.width; x += 1) {
			context.fillStyle =
				(x + y) % 2 === 0
					? lightAppearance
						? "#eeeae1"
						: "#27262c"
					: lightAppearance
						? "#e2ddd2"
						: "#222127"
			context.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize)
		}
	const frameIndex = project.frames.findIndex((frame) => frame.id === frameId)
	if (onionSkin && project.frames.length > 1) {
		const onionFrames = [
			{
				frame:
					project.frames[
						(frameIndex - 1 + project.frames.length) % project.frames.length
					],
				color: "#ff5f72",
			},
			{
				frame: project.frames[(frameIndex + 1) % project.frames.length],
				color: "#5fc8ff",
			},
		]
		for (const onion of onionFrames) {
			if (onion.frame === undefined || onion.frame.id === frameId) continue
			const rgba = compositeFrame(project, onion.frame.id)
			context.fillStyle = onion.color
			for (let index = 0; index < project.width * project.height; index += 1) {
				const alpha = rgba[index * 4 + 3] ?? 0
				if (alpha > 8) {
					context.globalAlpha = 0.16 + (alpha / 255) * 0.12
					context.fillRect(
						(index % project.width) * pixelSize,
						Math.floor(index / project.width) * pixelSize,
						pixelSize,
						pixelSize,
					)
				}
			}
		}
		context.globalAlpha = 1
	}
	const rgba = compositeFrame(project, frameId)
	for (let index = 0; index < project.width * project.height; index += 1) {
		const offset = index * 4
		const alpha = rgba[offset + 3] ?? 0
		if (alpha === 0) continue
		context.fillStyle = `rgba(${rgba[offset]}, ${rgba[offset + 1]}, ${rgba[offset + 2]}, ${alpha / 255})`
		context.fillRect(
			(index % project.width) * pixelSize,
			Math.floor(index / project.width) * pixelSize,
			pixelSize,
			pixelSize,
		)
	}
	if (pixelSize >= 8) {
		context.strokeStyle = lightAppearance
			? "rgba(31,28,22,.09)"
			: "rgba(255,255,255,.075)"
		context.lineWidth = 1
		context.beginPath()
		for (let x = 0; x <= project.width; x += 1) {
			context.moveTo(x * pixelSize + 0.5, 0)
			context.lineTo(x * pixelSize + 0.5, displayHeight)
		}
		for (let y = 0; y <= project.height; y += 1) {
			context.moveTo(0, y * pixelSize + 0.5)
			context.lineTo(displayWidth, y * pixelSize + 0.5)
		}
		context.stroke()
	}
}

function FramePreview({
	project,
	frameId,
	lightAppearance,
}: Readonly<{
	project: SpriteProject
	frameId: string
	lightAppearance: boolean
}>) {
	const ref = useRef<HTMLCanvasElement>(null)
	useEffect(() => {
		if (ref.current !== null)
			rgbaCanvas(
				ref.current,
				project,
				frameId,
				Math.max(1, Math.floor(144 / Math.max(project.width, project.height))),
				false,
				lightAppearance,
			)
	}, [project, frameId, lightAppearance])
	return (
		<div className="frame-preview">
			<canvas ref={ref} aria-label={`Preview of ${frameId}`} />
		</div>
	)
}

interface DrawingGesture {
	readonly pointerId: number
	readonly start: SpritePoint
	readonly base: Uint8Array
	readonly value: number
	last: SpritePoint
	working: Uint8Array
}

function pointForEvent(
	event: ReactPointerEvent<HTMLCanvasElement>,
	project: SpriteProject,
): SpritePoint {
	const rect = event.currentTarget.getBoundingClientRect()
	return {
		x: Math.max(
			0,
			Math.min(
				project.width - 1,
				Math.floor(((event.clientX - rect.left) / rect.width) * project.width),
			),
		),
		y: Math.max(
			0,
			Math.min(
				project.height - 1,
				Math.floor(((event.clientY - rect.top) / rect.height) * project.height),
			),
		),
	}
}

export function SpriteApplication({
	initialProject,
	sourceSession,
}: SpriteEditorBrowserOptions) {
	const [project, setProject] = useState(initialProject)
	const [past, setPast] = useState<readonly SpriteProject[]>([])
	const [future, setFuture] = useState<readonly SpriteProject[]>([])
	const [activeFrameId, setActiveFrameId] = useState(
		initialProject.frames[0]?.id ?? "",
	)
	const [activeLayerId, setActiveLayerId] = useState(
		initialProject.layers[0]?.id ?? "",
	)
	const [tool, setTool] = useState<SpriteTool>("pencil")
	const [brushSize, setBrushSize] = useState(1)
	const [primaryColor, setPrimaryColor] = useState(3)
	const [secondaryColor, setSecondaryColor] = useState(0)
	const [symmetryX, setSymmetryX] = useState(false)
	const [symmetryY, setSymmetryY] = useState(false)
	const [filledRectangle, setFilledRectangle] = useState(false)
	const [onionSkin, setOnionSkin] = useState(true)
	const [zoom, setZoom] = useState(16)
	const [playing, setPlaying] = useState(false)
	const [previewPixels, setPreviewPixels] = useState<Uint8Array | null>(null)
	const [saveState, setSaveState] = useState<SaveState>(
		sourceSession === undefined ? "offline" : "saved",
	)
	const [message, setMessage] = useState("Ready")
	const [cursorPoint, setCursorPoint] = useState<SpritePoint | null>(null)
	const [exportScale, setExportScale] = useState(4)
	const [exportColumns, setExportColumns] = useState(
		Math.min(4, initialProject.frames.length),
	)
	const [appearance, setAppearance] = useState<SpriteAppearance>(() => {
		if (typeof window === "undefined") return "system"
		try {
			return readSpriteAppearance(window.localStorage)
		} catch {
			return "system"
		}
	})
	const [systemPrefersLight, setSystemPrefersLight] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: light)").matches,
	)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [hotbarSlots, setHotbarSlots] = useState<HotbarSlots>(() => {
		if (typeof window === "undefined") return DEFAULT_SPRITE_HOTBAR_SLOTS
		try {
			return (
				parseHotbarSlots(
					window.localStorage.getItem(SPRITE_HOTBAR_STORAGE_KEY),
				) ?? DEFAULT_SPRITE_HOTBAR_SLOTS
			)
		} catch {
			return DEFAULT_SPRITE_HOTBAR_SLOTS
		}
	})
	const [tilingStatus, setTilingStatus] = useState<TilingWorkspaceStatus>({
		dirty: false,
		management: false,
	})
	const [tileCommandRequest, setTileCommandRequest] =
		useState<TileCommandRequest<SpriteTileKind> | null>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const gestureRef = useRef<DrawingGesture | null>(null)
	const revisionRef = useRef(0)
	const tileCommandSequence = useRef(0)
	const commandCenterRef = useRef<HTMLButtonElement>(null)

	const activeFrame =
		project.frames.find((frame) => frame.id === activeFrameId) ??
		project.frames[0]!
	const activeLayer =
		project.layers.find((layer) => layer.id === activeLayerId) ??
		project.layers[0]!
	const displayProject = useMemo(
		() =>
			previewPixels === null
				? project
				: setCelPixels(project, activeFrame.id, activeLayer.id, previewPixels),
		[project, previewPixels, activeFrame.id, activeLayer.id],
	)
	const lightAppearance = spriteAppearanceIsLight(
		appearance,
		systemPrefersLight,
	)
	const openCommandPalette = useCallback((): void => setPaletteOpen(true), [])
	const closeCommandPalette = useCallback((): void => {
		setPaletteOpen(false)
		requestAnimationFrame(() => commandCenterRef.current?.focus())
	}, [])
	const updateTilingStatus = useCallback(
		(status: TilingWorkspaceStatus): void => {
			setTilingStatus((current) =>
				current.dirty === status.dirty &&
				current.management === status.management
					? current
					: status,
			)
		},
		[],
	)

	const commit = useCallback(
		(next: SpriteProject, announcement = "Edited sprite") => {
			setProject((current) => {
				if (
					current === next ||
					JSON.stringify(current) === JSON.stringify(next)
				)
					return current
				setPast((history) => [...history.slice(-79), current])
				setFuture([])
				revisionRef.current += 1
				setSaveState(sourceSession === undefined ? "offline" : "dirty")
				setMessage(announcement)
				return next
			})
		},
		[sourceSession],
	)

	const undo = useCallback(() => {
		const previous = past.at(-1)
		if (previous === undefined) return
		setPast(past.slice(0, -1))
		setFuture((items) => [project, ...items])
		setProject(previous)
		setPreviewPixels(null)
		revisionRef.current += 1
		setSaveState(sourceSession === undefined ? "offline" : "dirty")
		setMessage("Undo")
	}, [past, project, sourceSession])
	const redo = useCallback(() => {
		const next = future[0]
		if (next === undefined) return
		setFuture(future.slice(1))
		setPast((items) => [...items, project])
		setProject(next)
		setPreviewPixels(null)
		revisionRef.current += 1
		setSaveState(sourceSession === undefined ? "offline" : "dirty")
		setMessage("Redo")
	}, [future, project, sourceSession])

	const save = useCallback(async () => {
		localStorage.setItem("create-sprites:recovery:v1", JSON.stringify(project))
		if (sourceSession === undefined) {
			setSaveState("offline")
			setMessage("Saved recovery copy in this browser")
			return
		}
		const revision = revisionRef.current
		setSaveState("saving")
		try {
			await sourceSession.save(project)
			if (revisionRef.current === revision) setSaveState("saved")
			else setSaveState("dirty")
			setMessage("Source saved")
		} catch (error) {
			setSaveState("error")
			setMessage(
				error instanceof Error ? error.message : "Could not save source",
			)
		}
	}, [project, sourceSession])

	useEffect(() => {
		localStorage.setItem("create-sprites:recovery:v1", JSON.stringify(project))
		if (sourceSession === undefined || saveState !== "dirty") return
		const timeout = window.setTimeout(() => void save(), 850)
		return () => window.clearTimeout(timeout)
	}, [project, save, saveState, sourceSession])

	useEffect(() => {
		document.title = `${project.title} — create-sprites`
	}, [project.title])

	useEffect(() => {
		try {
			localStorage.setItem(SPRITE_APPEARANCE_STORAGE_KEY, appearance)
		} catch {
			/* Appearance persistence is best-effort. */
		}
		document.documentElement.style.colorScheme =
			appearance === "system" ? "light dark" : appearance
		return () => {
			document.documentElement.style.colorScheme = ""
		}
	}, [appearance])

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: light)")
		const update = (): void => setSystemPrefersLight(media.matches)
		update()
		media.addEventListener("change", update)
		return () => media.removeEventListener("change", update)
	}, [])

	useEffect(() => {
		try {
			localStorage.setItem(
				SPRITE_HOTBAR_STORAGE_KEY,
				JSON.stringify(hotbarSlots),
			)
		} catch {
			/* Hotbar persistence is best-effort. */
		}
	}, [hotbarSlots])

	useEffect(() => {
		if (!playing) return
		const timeout = window.setTimeout(() => {
			const index = project.frames.findIndex(
				(frame) => frame.id === activeFrame.id,
			)
			setActiveFrameId(
				project.frames[(index + 1) % project.frames.length]?.id ??
					activeFrame.id,
			)
		}, activeFrame.duration)
		return () => window.clearTimeout(timeout)
	}, [playing, activeFrame, project.frames])

	useEffect(() => {
		const handleKey = (event: KeyboardEvent): void => {
			if (tilingStatus.management) return
			if (isCommandPaletteKeyboardEvent(event, IS_MAC_LIKE)) {
				event.preventDefault()
				openCommandPalette()
				return
			}
			if (paletteOpen) return
			if (
				event.target instanceof HTMLInputElement ||
				event.target instanceof HTMLSelectElement ||
				event.target instanceof HTMLTextAreaElement ||
				(event.target instanceof HTMLElement && event.target.isContentEditable)
			)
				return
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault()
				void save()
				return
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault()
				if (event.shiftKey) redo()
				else undo()
				return
			}
			const shortcut = (Object.keys(TOOL_INFO) as SpriteTool[]).find(
				(candidate) =>
					TOOL_INFO[candidate].key.toLowerCase() === event.key.toLowerCase(),
			)
			if (shortcut !== undefined) {
				setTool(shortcut)
				setMessage(`${TOOL_INFO[shortcut].label} tool`)
			} else if (event.key === " ") {
				event.preventDefault()
				setPlaying((active) => !active)
			} else if (event.key === "[")
				setBrushSize((size) => Math.max(1, size - 1))
			else if (event.key === "]") setBrushSize((size) => Math.min(8, size + 1))
			else if (event.key === "+") setZoom((value) => Math.min(32, value + 1))
		}
		window.addEventListener("keydown", handleKey)
		return () => window.removeEventListener("keydown", handleKey)
	}, [
		openCommandPalette,
		paletteOpen,
		redo,
		save,
		tilingStatus.management,
		undo,
	])

	useEffect(() => {
		if (canvasRef.current !== null)
			rgbaCanvas(
				canvasRef.current,
				displayProject,
				activeFrame.id,
				zoom,
				onionSkin,
				lightAppearance,
			)
	}, [displayProject, activeFrame.id, zoom, onionSkin, lightAppearance])

	const updateActiveLayer = (properties: Partial<SpriteLayer>): void =>
		commit(
			{
				...project,
				layers: project.layers.map((layer) =>
					layer.id === activeLayer.id ? { ...layer, ...properties } : layer,
				),
			},
			"Updated layer",
		)
	const updateActiveFrame = (properties: Partial<SpriteFrame>): void =>
		commit(
			{
				...project,
				frames: project.frames.map((frame) =>
					frame.id === activeFrame.id ? { ...frame, ...properties } : frame,
				),
			},
			"Updated frame",
		)

	const addLayer = (duplicate: boolean): void => {
		const id = nextIdentifier(
			"layer",
			project.layers.map((layer) => layer.id),
		)
		const layer: SpriteLayer = {
			id,
			name: duplicate
				? `${activeLayer.name} copy`
				: `Layer ${project.layers.length + 1}`,
			visible: true,
			locked: false,
			opacity: activeLayer.opacity,
		}
		const cels = [...project.cels]
		for (const frame of project.frames)
			cels.push({
				frameId: frame.id,
				layerId: id,
				rows: duplicate
					? (project.cels.find(
							(cel) =>
								cel.frameId === frame.id && cel.layerId === activeLayer.id,
						)?.rows ?? blankRows(project.width, project.height))
					: blankRows(project.width, project.height),
			})
		commit(
			{ ...project, layers: [...project.layers, layer], cels },
			duplicate ? "Duplicated layer" : "Added layer",
		)
		setActiveLayerId(id)
	}
	const deleteLayer = (): void => {
		if (project.layers.length <= 1) return
		const index = project.layers.findIndex(
			(layer) => layer.id === activeLayer.id,
		)
		const layers = project.layers.filter((layer) => layer.id !== activeLayer.id)
		commit(
			{
				...project,
				layers,
				cels: project.cels.filter((cel) => cel.layerId !== activeLayer.id),
			},
			"Deleted layer",
		)
		setActiveLayerId(layers[Math.max(0, index - 1)]?.id ?? layers[0]!.id)
	}
	const addFrame = (duplicate: boolean): void => {
		const id = nextIdentifier(
			"frame",
			project.frames.map((frame) => frame.id),
		)
		const frame: SpriteFrame = {
			id,
			name: `Frame ${project.frames.length + 1}`,
			duration: activeFrame.duration,
		}
		const index = project.frames.findIndex(
			(entry) => entry.id === activeFrame.id,
		)
		const frames = [
			...project.frames.slice(0, index + 1),
			frame,
			...project.frames.slice(index + 1),
		]
		const cels = [
			...project.cels,
			...project.layers.map((layer) => ({
				frameId: id,
				layerId: layer.id,
				rows: duplicate
					? (project.cels.find(
							(cel) =>
								cel.frameId === activeFrame.id && cel.layerId === layer.id,
						)?.rows ?? blankRows(project.width, project.height))
					: blankRows(project.width, project.height),
			})),
		]
		commit(
			{ ...project, frames, cels },
			duplicate ? "Duplicated frame" : "Added frame",
		)
		setActiveFrameId(id)
		setExportColumns((value) => Math.min(value, frames.length))
	}
	const deleteFrame = (): void => {
		if (project.frames.length <= 1) return
		const index = project.frames.findIndex(
			(frame) => frame.id === activeFrame.id,
		)
		const frames = project.frames.filter((frame) => frame.id !== activeFrame.id)
		commit(
			{
				...project,
				frames,
				cels: project.cels.filter((cel) => cel.frameId !== activeFrame.id),
				tags: project.tags.filter(
					(tag) =>
						tag.fromFrameId !== activeFrame.id &&
						tag.toFrameId !== activeFrame.id,
				),
			},
			"Deleted frame",
		)
		setActiveFrameId(frames[Math.max(0, index - 1)]?.id ?? frames[0]!.id)
		setExportColumns((value) => Math.min(value, frames.length))
	}

	const gestureValue = (event: ReactPointerEvent<HTMLCanvasElement>): number =>
		tool === "eraser"
			? TRANSPARENT_PIXEL
			: event.button === 2
				? secondaryColor
				: primaryColor
	const beginDrawing = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
		if (paletteOpen || tilingStatus.management) return
		event.preventDefault()
		const point = pointForEvent(event, project)
		if (tool === "eyedropper") {
			const value =
				celPixels(project, activeFrame.id, activeLayer.id)[
					point.y * project.width + point.x
				] ?? TRANSPARENT_PIXEL
			if (value !== TRANSPARENT_PIXEL) setPrimaryColor(value)
			setMessage(
				value === TRANSPARENT_PIXEL
					? "Transparent pixel"
					: `Sampled ${project.palette[value]?.name}`,
			)
			return
		}
		if (activeLayer.locked) {
			setMessage(`${activeLayer.name} is locked`)
			return
		}
		const base = celPixels(project, activeFrame.id, activeLayer.id)
		const value = gestureValue(event)
		if (tool === "fill") {
			commit(
				setCelPixels(
					project,
					activeFrame.id,
					activeLayer.id,
					floodFill(base, project.width, project.height, point, value),
				),
				"Filled area",
			)
			return
		}
		const working = paintPoints(
			base,
			project.width,
			project.height,
			[point],
			value,
			brushSize,
			symmetryX,
			symmetryY,
		)
		gestureRef.current = {
			pointerId: event.pointerId,
			start: point,
			last: point,
			base,
			value,
			working,
		}
		event.currentTarget.setPointerCapture(event.pointerId)
		setPreviewPixels(working)
	}
	const moveDrawing = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
		const point = pointForEvent(event, project)
		setCursorPoint(point)
		const gesture = gestureRef.current
		if (gesture === null || gesture.pointerId !== event.pointerId) return
		let next: Uint8Array
		if (tool === "line")
			next = paintPoints(
				gesture.base,
				project.width,
				project.height,
				linePoints(gesture.start, point),
				gesture.value,
				brushSize,
				symmetryX,
				symmetryY,
			)
		else if (tool === "rectangle")
			next = paintPoints(
				gesture.base,
				project.width,
				project.height,
				rectanglePoints(gesture.start, point, filledRectangle),
				gesture.value,
				brushSize,
				symmetryX,
				symmetryY,
			)
		else
			next = paintPoints(
				gesture.working,
				project.width,
				project.height,
				linePoints(gesture.last, point),
				gesture.value,
				brushSize,
				symmetryX,
				symmetryY,
			)
		gesture.last = point
		gesture.working = next
		setPreviewPixels(next)
	}
	const endDrawing = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
		const gesture = gestureRef.current
		if (gesture === null || gesture.pointerId !== event.pointerId) return
		gestureRef.current = null
		setPreviewPixels(null)
		commit(
			setCelPixels(project, activeFrame.id, activeLayer.id, gesture.working),
			`${TOOL_INFO[tool].label} stroke`,
		)
	}

	const updateColor = (index: number, color: Partial<SpriteColor>): void =>
		commit(
			{
				...project,
				palette: project.palette.map((entry, colorIndex) =>
					colorIndex === index ? { ...entry, ...color } : entry,
				),
			},
			"Updated palette",
		)
	const addColor = (): void => {
		if (project.palette.length >= 64) {
			setMessage("Indexed palettes support up to 64 colors")
			return
		}
		const id = nextIdentifier(
			"color",
			project.palette.map((color) => color.id),
		)
		commit(
			{
				...project,
				palette: [
					...project.palette,
					{
						id,
						name: `Color ${project.palette.length + 1}`,
						value: "#ffffffFF".toLowerCase(),
					},
				],
			},
			"Added palette color",
		)
		setPrimaryColor(project.palette.length)
	}
	const removeColor = (): void => {
		if (project.palette.length <= 1) return
		const removed = primaryColor
		const cels = project.cels.map((cel) => {
			const pixels = celPixels(project, cel.frameId, cel.layerId)
			for (let index = 0; index < pixels.length; index += 1) {
				if (pixels[index] === removed) pixels[index] = TRANSPARENT_PIXEL
				else if (
					(pixels[index] ?? 0) > removed &&
					pixels[index] !== TRANSPARENT_PIXEL
				)
					pixels[index] = (pixels[index] ?? 1) - 1
			}
			return {
				...cel,
				rows: blankRows(project.width, project.height).map((_, y) =>
					Array.from(
						pixels.slice(y * project.width, (y + 1) * project.width),
						(value) =>
							value === TRANSPARENT_PIXEL
								? "."
								: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"[
										value
									],
					).join(""),
				),
			}
		})
		commit(
			{
				...project,
				palette: project.palette.filter((_, index) => index !== removed),
				cels,
			},
			"Removed palette color",
		)
		setPrimaryColor(Math.max(0, removed - 1))
		setSecondaryColor((value) => Math.min(value, project.palette.length - 2))
	}

	const importPng = async (file: File): Promise<void> => {
		try {
			const pixels = await importPngToPalette(file, project)
			commit(
				setCelPixels(project, activeFrame.id, activeLayer.id, pixels),
				`Imported ${file.name}`,
			)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "PNG import failed")
		}
	}
	const addTag = (): void => {
		const tag = {
			id: nextIdentifier(
				"tag",
				project.tags.map((item) => item.id),
			),
			name: "Loop",
			fromFrameId: project.frames[0]!.id,
			toFrameId: project.frames.at(-1)!.id,
			direction: "forward" as const,
		}
		commit({ ...project, tags: [...project.tags, tag] }, "Added animation tag")
	}
	const updateTagDirection = (direction: SpritePlaybackDirection): void =>
		commit(
			{
				...project,
				tags: project.tags.map((tag, index) =>
					index === 0 ? { ...tag, direction } : tag,
				),
			},
			"Updated animation tag",
		)

	const tileContext: SpriteTileContext = {
		project,
		activeFrame,
		activeLayer,
		tool,
		brushSize,
		primaryColor,
		secondaryColor,
		symmetryX,
		symmetryY,
		filledRectangle,
		playing,
		lightAppearance,
		saveState,
		exportScale,
		exportColumns,
		setTool,
		setBrushSize,
		setPrimaryColor,
		setSecondaryColor,
		setSymmetryX,
		setSymmetryY,
		setFilledRectangle,
		setTitle: (title) => commit({ ...project, title }, "Renamed project"),
		updateColor,
		addColor,
		removeColor,
		selectLayer: setActiveLayerId,
		updateLayer: updateActiveLayer,
		addLayer,
		deleteLayer,
		updateFrame: updateActiveFrame,
		addFrame,
		deleteFrame,
		togglePlayback: () => setPlaying((active) => !active),
		addTag,
		updateTagDirection,
		save: () => void save(),
		importPng: (file) => void importPng(file),
		exportFrame: () =>
			void exportFramePng(project, activeFrame.id, exportScale).catch((error) =>
				setMessage(String(error)),
			),
		exportSheet: () =>
			void exportSpriteSheet(project, exportScale, exportColumns).catch(
				(error) => setMessage(String(error)),
			),
		exportProject: () => exportProjectJson(project),
		setExportScale,
		setExportColumns,
	}
	const toolIcons = {
		pencil: "Pencil1Icon",
		eraser: "HobbyKnifeIcon",
		fill: "Half2Icon",
		line: "AlignCenterVerticallyIcon",
		rectangle: "SquareIcon",
		eyedropper: "DotFilledIcon",
	} as const
	const commands: readonly PaletteCommand[] = [
		...(Object.keys(TOOL_INFO) as SpriteTool[]).map(
			(candidate): PaletteCommand => ({
				id: `tool-${candidate}`,
				displayName: `${TOOL_INFO[candidate].label} tool`,
				category: "Tools",
				description: `Switch to the ${TOOL_INFO[candidate].label.toLowerCase()} pixel tool.`,
				icon: toolIcons[candidate],
				shortcut: TOOL_INFO[candidate].key,
				checked: tool === candidate,
				do: () => {
					setTool(candidate)
					setMessage(`${TOOL_INFO[candidate].label} tool`)
				},
			}),
		),
		{
			id: "undo",
			displayName: "Undo",
			category: "Edit",
			description: "Undo the last sprite edit.",
			icon: "DoubleArrowLeftIcon",
			shortcut: `${MOD_KEY_LABEL}+Z`,
			disabled: past.length === 0,
			disabledReason: "There is nothing to undo.",
			do: undo,
		},
		{
			id: "redo",
			displayName: "Redo",
			category: "Edit",
			description: "Redo the last undone edit.",
			icon: "DoubleArrowRightIcon",
			shortcut: `${MOD_KEY_LABEL}+Shift+Z`,
			disabled: future.length === 0,
			disabledReason: "There is nothing to redo.",
			do: redo,
		},
		{
			id: "save",
			displayName: "Save source",
			category: "File",
			description: "Save editable sprite source and the browser recovery copy.",
			icon: "StarIcon",
			shortcut: `${MOD_KEY_LABEL}+S`,
			disabled: saveState === "saving",
			disabledReason: "A save is already in progress.",
			status: saveState,
			do: () => void save(),
		},
		{
			id: "toggle-onion-skin",
			displayName: "Toggle onion skin",
			category: "Animation",
			description: "Show adjacent frames behind the active frame.",
			icon: "Half2Icon",
			checked: onionSkin,
			do: () => setOnionSkin((active) => !active),
		},
		{
			id: "toggle-playback",
			displayName: playing ? "Pause animation" : "Play animation",
			category: "Animation",
			description: "Start or stop timing-aware animation playback.",
			icon: "DoubleArrowRightIcon",
			shortcut: "Space",
			checked: playing,
			do: () => setPlaying((active) => !active),
		},
		{
			id: "toggle-symmetry-x",
			displayName: "Toggle horizontal mirror",
			category: "Drawing",
			description: "Mirror drawing strokes across the vertical canvas axis.",
			icon: "TransformIcon",
			checked: symmetryX,
			do: () => setSymmetryX((active) => !active),
		},
		{
			id: "toggle-symmetry-y",
			displayName: "Toggle vertical mirror",
			category: "Drawing",
			description: "Mirror drawing strokes across the horizontal canvas axis.",
			icon: "TransformIcon",
			checked: symmetryY,
			do: () => setSymmetryY((active) => !active),
		},
		{
			id: "new-frame",
			displayName: "New blank frame",
			category: "Frames",
			description: "Insert a blank frame after the active frame.",
			icon: "PlusIcon",
			do: () => addFrame(false),
		},
		{
			id: "duplicate-frame",
			displayName: "Duplicate frame",
			category: "Frames",
			description: "Insert a copy of the active frame.",
			icon: "ShuffleIcon",
			do: () => addFrame(true),
		},
		{
			id: "delete-frame",
			displayName: "Delete frame",
			category: "Frames",
			description: "Delete the active frame and its cels.",
			icon: "HobbyKnifeIcon",
			disabled: project.frames.length <= 1,
			disabledReason: "A sprite needs at least one frame.",
			do: deleteFrame,
		},
		{
			id: "new-layer",
			displayName: "New layer",
			category: "Layers",
			description: "Add a blank layer to every frame.",
			icon: "PlusIcon",
			do: () => addLayer(false),
		},
		{
			id: "duplicate-layer",
			displayName: "Duplicate layer",
			category: "Layers",
			description: "Copy the active layer and all of its cels.",
			icon: "ShuffleIcon",
			do: () => addLayer(true),
		},
		{
			id: "delete-layer",
			displayName: "Delete layer",
			category: "Layers",
			description: "Delete the active layer and all of its cels.",
			icon: "HobbyKnifeIcon",
			disabled: project.layers.length <= 1,
			disabledReason: "A sprite needs at least one layer.",
			do: deleteLayer,
		},
		{
			id: "zoom-in",
			displayName: "Zoom in",
			category: "View",
			description: "Increase the pixel canvas zoom.",
			icon: "PlusIcon",
			disabled: zoom >= 32,
			disabledReason: "The canvas is at maximum zoom.",
			status: `${zoom}×`,
			do: () => setZoom((value) => Math.min(32, value + 2)),
		},
		{
			id: "zoom-out",
			displayName: "Zoom out",
			category: "View",
			description: "Decrease the pixel canvas zoom.",
			icon: "CircleIcon",
			disabled: zoom <= 2,
			disabledReason: "The canvas is at minimum zoom.",
			status: `${zoom}×`,
			do: () => setZoom((value) => Math.max(2, value - 2)),
		},
		{
			id: "appearance-system",
			displayName: "Use system appearance",
			category: "Appearance",
			description: "Follow the operating system light or dark preference.",
			icon: "Half2Icon",
			checked: appearance === "system",
			do: () => setAppearance("system"),
		},
		{
			id: "appearance-light",
			displayName: "Use light appearance",
			category: "Appearance",
			description: "Use the light create-sprites color scheme.",
			icon: "CircleIcon",
			checked: appearance === "light",
			do: () => setAppearance("light"),
		},
		{
			id: "appearance-dark",
			displayName: "Use dark appearance",
			category: "Appearance",
			description: "Use the dark create-sprites color scheme.",
			icon: "DotFilledIcon",
			checked: appearance === "dark",
			do: () => setAppearance("dark"),
		},
		{
			id: "export-current-frame",
			displayName: "Export current frame PNG",
			category: "Export",
			description: "Export the composited active frame as a scaled PNG.",
			icon: "Link1Icon",
			do: () =>
				void exportFramePng(project, activeFrame.id, exportScale).catch(
					(error) => setMessage(String(error)),
				),
		},
		{
			id: "export-sprite-sheet",
			displayName: "Export sprite sheet",
			category: "Export",
			description: "Export a PNG sprite sheet and animation metadata JSON.",
			icon: "Link1Icon",
			do: () =>
				void exportSpriteSheet(project, exportScale, exportColumns).catch(
					(error) => setMessage(String(error)),
				),
		},
		{
			id: "export-project-json",
			displayName: "Export portable project JSON",
			category: "Export",
			description:
				"Export the complete editable sprite project as one JSON file.",
			icon: "Link1Icon",
			do: () => exportProjectJson(project),
		},
		...tileRegistryCommands(SPRITE_TILE_REGISTRY, tileContext).map(
			(command): PaletteCommand => ({
				...command,
				do: () => {
					tileCommandSequence.current += 1
					setTileCommandRequest({
						id: tileCommandSequence.current,
						kind: command.kind,
					})
				},
			}),
		),
	]

	return (
		<div className="sprite-application" data-appearance={appearance}>
			<header>
				<div className="brand-lockup">
					<span className="pixel-logo" aria-hidden="true">
						<i />
						<i />
						<i />
						<i />
						<i />
						<i />
						<i />
					</span>
					<span>
						<strong>{project.title}</strong>
						<small>create-sprites · indexed animation</small>
					</span>
				</div>
				<div className="command-center">
					<button
						ref={commandCenterRef}
						type="button"
						aria-label="Open Command Palette"
						aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
						onClick={openCommandPalette}
					>
						<span aria-hidden="true">⌕</span>
						<strong>Commands</strong>
						<kbd>{MOD_KEY_LABEL}+Shift+P</kbd>
					</button>
				</div>
				<div className="header-actions">
					<label className="appearance-control">
						<span>Appearance</span>
						<select
							value={appearance}
							onChange={(event) =>
								setAppearance(event.currentTarget.value as SpriteAppearance)
							}
						>
							<option value="system">System</option>
							<option value="light">Light</option>
							<option value="dark">Dark</option>
						</select>
					</label>
					<button
						type="button"
						disabled={past.length === 0}
						onClick={undo}
						aria-label="Undo"
					>
						↶
					</button>
					<button
						type="button"
						disabled={future.length === 0}
						onClick={redo}
						aria-label="Redo"
					>
						↷
					</button>
					<button
						type="button"
						className="save-button"
						data-state={saveState}
						onClick={() => void save()}
					>
						{saveState === "saving"
							? "Saving…"
							: saveState === "saved"
								? "Saved"
								: saveState === "offline"
									? "Browser copy"
									: "Save"}
					</button>
				</div>
			</header>
			<main>
				<div className="canvas-viewport">
					<div className="canvas-board">
						<canvas
							ref={canvasRef}
							aria-label={`${project.title} pixel canvas`}
							onContextMenu={(event) => event.preventDefault()}
							onPointerDown={beginDrawing}
							onPointerMove={moveDrawing}
							onPointerUp={endDrawing}
							onPointerCancel={endDrawing}
							onPointerLeave={() => setCursorPoint(null)}
						/>
					</div>
					<div className="canvas-hud">
						<button
							type="button"
							data-active={onionSkin || undefined}
							onClick={() => setOnionSkin((active) => !active)}
						>
							◐ Onion
						</button>
						<label>
							Zoom
							<input
								type="range"
								min="2"
								max="32"
								value={zoom}
								onChange={(event) => setZoom(Number(event.currentTarget.value))}
							/>
							<output>{zoom}×</output>
						</label>
					</div>
				</div>
				<TilingWorkspace
					context={tileContext}
					registry={SPRITE_TILE_REGISTRY}
					defaultLayout={DEFAULT_LAYOUT}
					storageKey="create-sprites:tiling-workspace:v1"
					commandRequest={tileCommandRequest}
					enabled={!paletteOpen}
					onStatusChange={updateTilingStatus}
				/>
				<ActionHotbar
					commands={commands}
					enabled={!paletteOpen && !tilingStatus.management}
					paletteOpen={paletteOpen}
					slots={hotbarSlots}
					onAssignCommand={(commandId, slotIndex) =>
						setHotbarSlots(
							(current) =>
								assignPaletteCommandToHotbar(
									current,
									slotIndex,
									commandId,
									"drag",
								).slots,
						)
					}
					onOpenCommands={openCommandPalette}
					onSlotsChange={setHotbarSlots}
				/>
			</main>
			<section className="timeline" aria-label="Animation timeline">
				<div className="timeline-controls">
					<button
						type="button"
						onClick={() => setActiveFrameId(project.frames[0]!.id)}
					>
						▮◀
					</button>
					<button
						type="button"
						className="play"
						onClick={() => setPlaying((active) => !active)}
					>
						{playing ? "❚❚" : "▶"}
					</button>
					<button
						type="button"
						onClick={() => setActiveFrameId(project.frames.at(-1)!.id)}
					>
						▶▮
					</button>
					<strong>Timeline</strong>
					<span>
						{project.frames.length} frames ·{" "}
						{Math.round(
							project.frames.reduce((sum, frame) => sum + frame.duration, 0),
						)}{" "}
						ms
					</span>
					<button type="button" onClick={() => addFrame(false)}>
						＋ Frame
					</button>
					<button type="button" onClick={() => addFrame(true)}>
						⧉ Duplicate
					</button>
				</div>
				<div
					className="timeline-grid"
					style={{
						gridTemplateColumns: `156px repeat(${project.frames.length}, 74px)`,
					}}
				>
					<div className="timeline-corner">Layer / cel</div>
					{project.frames.map((frame, index) => (
						<button
							type="button"
							className="frame-heading"
							data-active={frame.id === activeFrame.id || undefined}
							key={frame.id}
							onClick={() => setActiveFrameId(frame.id)}
						>
							<strong>{index + 1}</strong>
							<span>{frame.duration} ms</span>
						</button>
					))}
					{[...project.layers].reverse().flatMap((layer) => [
						<button
							type="button"
							className="layer-heading"
							data-active={layer.id === activeLayer.id || undefined}
							key={`layer:${layer.id}`}
							onClick={() => setActiveLayerId(layer.id)}
						>
							<span>{layer.visible ? "◉" : "○"}</span>
							<strong>{layer.name}</strong>
							<small>{layer.locked ? "◆" : ""}</small>
						</button>,
						...project.frames.map((frame) => {
							const cel = project.cels.find(
								(entry) =>
									entry.frameId === frame.id && entry.layerId === layer.id,
							)
							const occupied =
								cel?.rows.some((row) => /[^.]/.test(row)) ?? false
							return (
								<button
									type="button"
									className="cel"
									data-active={
										(frame.id === activeFrame.id &&
											layer.id === activeLayer.id) ||
										undefined
									}
									data-occupied={occupied || undefined}
									key={`${frame.id}/${layer.id}`}
									onClick={() => {
										setActiveFrameId(frame.id)
										setActiveLayerId(layer.id)
									}}
								>
									<span />
								</button>
							)
						}),
					])}
				</div>
			</section>
			<footer>
				<span role="status" aria-live="polite">
					{message}
				</span>
				<span className="keyboard-help">
					{tilingStatus.management
						? "Tile management active · Esc exits"
						: paletteOpen
							? "Search commands · Mod+Enter assigns to hotbar"
							: `1–= Hotbar · ${MOD_KEY_LABEL}+Shift+P Commands`}
				</span>
				<span>
					{cursorPoint === null ? "—" : `${cursorPoint.x}, ${cursorPoint.y}`}
				</span>
				<span>
					{activeLayer.name} / {activeFrame.name}
				</span>
				<span>
					{project.width}×{project.height} px
				</span>
			</footer>
			{paletteOpen ? (
				<CommandPalette
					commands={commands}
					onCancel={closeCommandPalette}
					onExecute={(command) => {
						command.do()
						closeCommandPalette()
					}}
					onAssign={(command, slotIndex) => {
						const assignment = assignPaletteCommandToHotbar(
							hotbarSlots,
							slotIndex,
							command.id,
							"keyboard",
						)
						setHotbarSlots(assignment.slots)
						if (assignment.closePalette) closeCommandPalette()
					}}
				/>
			) : null}
		</div>
	)
}
