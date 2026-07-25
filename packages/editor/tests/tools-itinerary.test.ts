import type { ContourId, PointId } from "@create-font/states"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { resolveGesturePoint } from "../src/canvas-snapping.ts"
import { oGlyphId } from "../src/demo-font.ts"
import { TOOLS, toolForKeyboardEvent } from "../src/editor-tools-and-hotkeys.ts"
import {
	createEditorWorkspace,
	type EditorToolId,
} from "../src/editor-workspace.ts"
import {
	combineMarqueeSelection,
	marqueeSelectionMode,
	type EditorSelectionTarget,
} from "../src/outline-selection.ts"
import { resolvePenGesture } from "../src/pen-gesture.ts"
import { constrainRulePointToAngle, measureRule } from "../src/rule-geometry.ts"
import { resolveShapeGesture, shapeGeometry } from "../src/shape-gesture.ts"
import {
	reduceVectorGesture,
	type VectorGestureDown,
	type VectorGestureDownInput,
	type VectorGestureEvent,
	type VectorGesturePolicy,
	type VectorGestureState,
	type VectorTransformHandle,
} from "../src/vector-gesture.ts"

type FontCanvasTool = Extract<
	EditorToolId,
	"select" | "pen" | "rect" | "ellipse" | "knife" | "rule" | "transform"
>

interface ExistingTestReference {
	readonly file: `${string}.test.ts`
	/** Stable phrase from the referenced Vitest title. */
	readonly test: string
}

interface ToolBehavior {
	readonly id: string
	readonly expectation: string
	readonly issues: readonly number[]
	readonly coveredBy: readonly ExistingTestReference[]
}

interface ToolItinerary {
	readonly tool: FontCanvasTool
	readonly shortcut: string
	readonly purpose: string
	readonly behaviors: readonly ToolBehavior[]
}

const coveredBy = (
	file: ExistingTestReference["file"],
	test: string,
): ExistingTestReference => ({ file, test })

/**
 * Executable index of create-font's canvas-tool contract.
 *
 * The issue links record product intent. `coveredBy` records the deeper test
 * that protects each behavior. The sentinel assertions below protect the most
 * refactor-sensitive seams in one place.
 */
export const FONT_TOOL_ITINERARY = [
	{
		tool: "select",
		shortcut: "v",
		purpose: "Select and edit nodes, handles, segments, and whole contours.",
		behaviors: [
			{
				id: "selection-and-hit-precedence",
				expectation:
					"Forgiving screen-space helpers choose controls before segments, while whole-contour double-click works in Select and Transform.",
				issues: [48, 79, 80, 198, 200, 212],
				coveredBy: [
					coveredBy(
						"canvas-hit-testing.test.ts",
						"always resolves an eligible control before a path",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"selects a whole contour and refreshes Transform bounds immediately",
					),
				],
			},
			{
				id: "marquee-modes",
				expectation:
					"Marquee replaces by default, adds with Mod, inverts every covered target with Shift, and treats Shift as the combined-modifier winner.",
				issues: [165, 198],
				coveredBy: [
					coveredBy(
						"glyph-canvas-marquee.test.ts",
						"uses Shift-first inversion while preserving add and replace gestures",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Select — preserves toggle marquee precedence and snap/commit parity",
					),
				],
			},
			{
				id: "direct-drag-constraints-and-snapping",
				expectation:
					"Node drags use one preview/commit coordinate path with Shift constraints, node/metric snaps, and incident-segment projection.",
				issues: [42, 55, 57, 60],
				coveredBy: [
					coveredBy(
						"canvas-snapping.test.ts",
						"returns identical coordinates for preview and commit resolution",
					),
					coveredBy(
						"canvas-snapping.test.ts",
						"uses screen distance, stable ties, and explicit constraint precedence",
					),
				],
			},
			{
				id: "group-translation",
				expectation:
					"Dragging a selected node or owned segment translates the complete selection rigidly, with group snapping, cancellation, and one history commit.",
				issues: [56, 100, 136, 175],
				coveredBy: [
					coveredBy(
						"glyph-canvas-group-cancel.test.ts",
						"keeps a selected multi-contour glyph visually aligned with a pointer drag",
					),
					coveredBy(
						"glyph-canvas-group-cancel.test.ts",
						"previews, commits, and undoes a multi-soft-node controlled drag atomically",
					),
					coveredBy(
						"canvas-snapping.test.ts",
						"snaps group edges and centers independently",
					),
				],
			},
			{
				id: "node-and-handle-editing",
				expectation:
					"Hard and soft handles preserve their distinct invariants across constrained dragging, tangent sliding, Alt fixed-endpoint movement, and mixed selections.",
				issues: [103, 121, 122, 123, 148, 175],
				coveredBy: [
					coveredBy(
						"select-editing.test.ts",
						"shares hard, symmetric, and one-sided soft handle resolution",
					),
					coveredBy(
						"select-editing.test.ts",
						"maps the soft controller displacement to each tangent and fixes hard handles",
					),
					coveredBy(
						"glyph-canvas-nudge.test.ts",
						"Alt-nudges one hard node while its absolute endpoints stay fixed",
					),
				],
			},
			{
				id: "keyboard-nudging",
				expectation:
					"Arrow keys move every selected node/handle with 1×, 10×, and 100× steps without dropping selection or splitting history.",
				issues: [82, 123, 136, 148],
				coveredBy: [
					coveredBy(
						"glyph-canvas-nudge.test.ts",
						"nudges every selected node in one atomic action and preserves selection",
					),
					coveredBy(
						"select-editing.test.ts",
						"moves a hard handle independently and mixed owner controls rigidly",
					),
				],
			},
			{
				id: "topology-and-selection-commands",
				expectation:
					"Endpoint joining, node-mode toggling, align, reverse, make-first, and inversion preserve topology and atomic history.",
				issues: [43, 45, 47, 97, 105, 118, 134, 164],
				coveredBy: [
					coveredBy(
						"topology-tools.test.ts",
						"allows only the opposite endpoint from the source contour",
					),
					coveredBy(
						"glyph-canvas-node-mode.test.ts",
						"toggles every selected node once and preserves node-and-handle selection",
					),
					coveredBy(
						"editor-tools-and-hotkeys.test.ts",
						"reverses open paths and remaps handle selection through history",
					),
					coveredBy(
						"editor-tools-and-hotkeys.test.ts",
						"dispatches alignment as one mixed-control state action",
					),
				],
			},
			{
				id: "clipboard-round-trip",
				expectation:
					"Copy, cut, and paste preserve topology and handles, use fresh IDs, fully select pasted contours, remain mode-aware, and are atomic.",
				issues: [58, 99, 166, 174],
				coveredBy: [
					coveredBy(
						"outline-clipboard.test.ts",
						"copies a whole curved contour from the active master",
					),
					coveredBy(
						"outline-clipboard.test.ts",
						"fully selects pasted nodes and each existing active-layer handle",
					),
					coveredBy(
						"glyph-canvas-cut.test.ts",
						"pastes the Cut fragment with fresh, fully selected points and handles",
					),
					coveredBy(
						"glyph-canvas-cut.test.ts",
						"writes copy-compatible formats, deletes represented nodes, and round-trips history",
					),
					coveredBy(
						"glyph-canvas-cut.test.ts",
						"copies from one master and pastes into another master of the same glyph",
					),
				],
			},
		],
	},
	{
		tool: "pen",
		shortcut: "q",
		purpose: "Author, extend, close, and split cubic contours.",
		behaviors: [
			{
				id: "hard-and-soft-placement",
				expectation:
					"Clicks author hard nodes; drags beyond a zoom-stable four-pixel threshold author symmetric soft handles in font y-up space.",
				issues: [61],
				coveredBy: [
					coveredBy(
						"pen-gesture.test.ts",
						"keeps pointer jitter as a hard click at every zoom",
					),
					coveredBy(
						"pen-gesture.test.ts",
						"inverts screen y while preserving preview and commit parity",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"Pen — previews without a selection halo and commits click/curve history",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Pen — preserves y-up click, curve, modifier, and cancellation semantics",
					),
				],
			},
			{
				id: "constraint-and-live-modifiers",
				expectation:
					"Shift constrains placement and handles to documented rays, including modifier changes during the active gesture.",
				issues: [60, 103],
				coveredBy: [
					coveredBy(
						"pen-gesture.test.ts",
						"constrains Shift handles to all eight rays and resolves ties deterministically",
					),
					coveredBy(
						"canvas-snapping.test.ts",
						"applies and removes Shift against the same raw candidate without moving the anchor",
					),
				],
			},
			{
				id: "open-endpoint-authoring",
				expectation:
					"Either open endpoint can be resumed, hardened, or given a forward handle without damaging its connected segment.",
				issues: [61, 103],
				coveredBy: [
					coveredBy(
						"pen-gesture.test.ts",
						"authors soft, hard, Alt-converted, and cancelled endpoint handles on either side",
					),
					coveredBy(
						"pen-gesture.test.ts",
						"aligns append and prepend closure tangents with their drags",
					),
				],
			},
			{
				id: "segment-edit-precedence",
				expectation:
					"Pen segment clicks split geometry, while Select Alt-click adds line-equivalent one-third handles and control hits retain priority.",
				issues: [46, 59],
				coveredBy: [
					coveredBy(
						"curve-editing.test.ts",
						"keeps Pen insertion ahead of the Alt/Option segment gesture",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"Pen — routes an authored segment press through one split action",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"Select — Alt-clicks a straight segment into line-equivalent handles",
					),
					coveredBy(
						"pen-gesture.test.ts",
						"preserves segment, closure, control, then background semantics",
					),
				],
			},
			{
				id: "topology-history-and-cancellation",
				expectation:
					"Placement, closure, insertion, and endpoint edits preserve valid active-master topology, commit once, and leave nothing on cancellation.",
				issues: [46, 61, 103, 118],
				coveredBy: [
					coveredBy(
						"pen-gesture.test.ts",
						"maps nodes and dragged endpoints into every master",
					),
					coveredBy(
						"vector-gesture.test.ts",
						"cancels atomically and ignores unrelated pointer transitions",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"%s — pointer cancellation clears preview and commits nothing",
					),
					coveredBy(
						"topology-tools.test.ts",
						"assigns group joins to moved endpoints deterministically",
					),
				],
			},
			{
				id: "preview-performance",
				expectation:
					"Pointer bursts coalesce to animation frames while pointer-up still commits the newest raw coordinates.",
				issues: [106, 113],
				coveredBy: [
					coveredBy(
						"animation-frame-publisher.test.ts",
						"publishes one latest-value update for a burst within a frame",
					),
					coveredBy(
						"animation-frame-publisher.test.ts",
						"consumes the latest raw value without publishing a pending preview",
					),
				],
			},
		],
	},
	{
		tool: "rect",
		shortcut: "r",
		purpose: "Author editable rectangular contours.",
		behaviors: [
			{
				id: "rect-gesture",
				expectation:
					"Rectangle drag is quadrant-stable, thresholded in screen pixels, Shift-constrained, Alt-centered, snap-aware, and cancelable.",
				issues: [119, 133],
				coveredBy: [
					coveredBy(
						"shape-gesture.test.ts",
						"uses the CSS-pixel threshold independently of zoom or font distance",
					),
					coveredBy(
						"shape-gesture.test.ts",
						"combines Alt and Shift using the raw dominant axis and remembered direction",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Rectangle — preserves centered constrained geometry",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"%s — reflects live Shift+Alt preview modifiers into one undoable contour",
					),
				],
			},
			{
				id: "rect-geometry-and-commit",
				expectation:
					"A valid gesture emits one clockwise four-hard-node contour, projects cleanly to the active layer, and commits once.",
				issues: [119],
				coveredBy: [
					coveredBy(
						"shape-gesture.test.ts",
						"emits a clockwise four-hard-node rectangle",
					),
					coveredBy(
						"shape-gesture.test.ts",
						"keeps the active layer exact and projects absolute handle endpoints",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"%s — reflects live Shift+Alt preview modifiers into one undoable contour",
					),
				],
			},
		],
	},
	{
		tool: "ellipse",
		shortcut: "o",
		purpose: "Author editable cubic elliptical contours.",
		behaviors: [
			{
				id: "ellipse-gesture",
				expectation:
					"Ellipse drag shares Rectangle's quadrant, threshold, Shift, Alt, snapping, modifier-transition, and cancellation semantics.",
				issues: [120, 133],
				coveredBy: [
					coveredBy(
						"shape-gesture.test.ts",
						"reflects snapped extrema without moving the center",
					),
					coveredBy(
						"shape-gesture.test.ts",
						"preserves the last non-zero quadrant direction across axis crossings",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Ellipse — preserves centered constrained cubic geometry",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"%s — pointer cancellation clears preview and commits nothing",
					),
				],
			},
			{
				id: "ellipse-geometry-and-commit",
				expectation:
					"A valid gesture emits four soft extrema with kappa handles, clockwise topology, active-layer projection, and one commit.",
				issues: [120],
				coveredBy: [
					coveredBy(
						"shape-gesture.test.ts",
						"emits top/right/bottom/left soft ellipse extrema with kappa handles",
					),
					coveredBy(
						"shape-gesture.test.ts",
						"returns no geometry for degenerate bounds",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"%s — reflects live Shift+Alt preview modifiers into one undoable contour",
					),
				],
			},
		],
	},
	{
		tool: "knife",
		shortcut: "k",
		purpose: "Break straight or cubic contours at an interior segment point.",
		behaviors: [
			{
				id: "knife-hit-and-gating",
				expectation:
					"Knife is glyph-edit-only, chooses the nearest eligible segment after control precedence, and rejects endpoint-adjacent cuts.",
				issues: [117],
				coveredBy: [
					coveredBy(
						"editor-tools-and-hotkeys.test.ts",
						"maps Q to pen, K to knife, and V to select",
					),
					coveredBy(
						"canvas-hit-testing.test.ts",
						"always resolves an eligible control before a path",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"Knife — routes an authored segment click through one cut action",
					),
				],
			},
			{
				id: "knife-geometry-and-topology",
				expectation:
					"Straight and cubic cuts preserve rendered geometry; closed paths become one open traversal and open paths become two open contours with distinct coincident endpoints.",
				issues: [117],
				coveredBy: [
					coveredBy(
						"tools-itinerary.test.ts",
						"Knife — cuts closed and open cubic topology atomically",
					),
					coveredBy(
						"topology-tools.test.ts",
						"separates either selected half of a coincident Knife cut",
					),
				],
			},
			{
				id: "knife-history-and-validation",
				expectation:
					"Each valid cut is one history edit; invalid IDs, parameters, or topology roll back without partial geometry.",
				issues: [117],
				coveredBy: [
					coveredBy(
						"tools-itinerary.test.ts",
						"Knife — cuts closed and open cubic topology atomically",
					),
				],
			},
		],
	},
	{
		tool: "rule",
		shortcut: "m",
		purpose: "Author persistent oriented measurements over glyph geometry.",
		behaviors: [
			{
				id: "rule-authoring",
				expectation:
					"Plotting distinct A then B creates one infinite oriented rule; Shift constrains 15-degree angles, free points snap, and cancellation creates nothing.",
				issues: [211],
				coveredBy: [
					coveredBy(
						"glyph-canvas-rule.test.ts",
						"previews a pending rule and commits its Shift-constrained angle",
					),
					coveredBy(
						"glyph-canvas-rule.test.ts",
						"snaps unconstrained rule points independently to node coordinates",
					),
					coveredBy(
						"tools-itinerary.integration.test.ts",
						"Rule — Escape cancels the pending first point without persistence",
					),
				],
			},
			{
				id: "rule-measurement",
				expectation:
					"Closed forms/counterforms produce deterministic oriented occupancy events and finite labels; open contours and tangencies add no false spans.",
				issues: [211],
				coveredBy: [
					coveredBy(
						"rule-geometry.test.ts",
						"treats same-winding overlap as a union and counterforms as subtraction",
					),
					coveredBy(
						"rule-geometry.test.ts",
						"ignores open contours and tangent touches",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Rule — measures form/counterform occupancy and ignores open contours",
					),
				],
			},
			{
				id: "rule-persistence-selection-and-clipboard",
				expectation:
					"Rules persist per glyph with stable IDs and history, remain editor-only, and support selection, deletion, cut/copy/paste, and fresh pasted IDs.",
				issues: [211],
				coveredBy: [
					coveredBy(
						"glyph-canvas-rule.test.ts",
						"selects a completed rule by its line in Rule mode and deletes it",
					),
					coveredBy(
						"glyph-canvas-rule.test.ts",
						"reconciles a rule removed by undo and lets outline copy proceed",
					),
					coveredBy(
						"rule-clipboard.test.ts",
						"round trips rules without identity and allocates fresh IDs",
					),
				],
			},
		],
	},
	{
		tool: "transform",
		shortcut: "t",
		purpose: "Translate, scale, mirror, and rotate the selected controls.",
		behaviors: [
			{
				id: "transform-bounds-and-selection",
				expectation:
					"Bounds include selected node positions and selected handle endpoints; Transform contour double-click refreshes all affordances immediately.",
				issues: [44, 212],
				coveredBy: [
					coveredBy(
						"editor-workspace.test.ts",
						"resolves, bounds, aligns, translates, and scales mixed controls deterministically",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"selects a whole contour and refreshes Transform bounds immediately",
					),
				],
			},
			{
				id: "transform-translation-and-resize",
				expectation:
					"Inside drags translate rigidly; all eight handles resize from their visually opposite y-up anchor with preview/commit parity.",
				issues: [44],
				coveredBy: [
					coveredBy(
						"transform-gesture.test.ts",
						"switches between opposite-edge and center math from original bounds",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"keeps the opposite visual anchor fixed when dragging the %s handle",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"translates the mounted selection box rigidly in font coordinates",
					),
					coveredBy(
						"tools-itinerary.test.ts",
						"Transform — keeps the visual opposite anchor fixed for all eight y-up handles",
					),
				],
			},
			{
				id: "transform-modifiers-and-degeneracy",
				expectation:
					"Shift locks aspect, Alt scales from center, live modifier changes restart from original bounds, crossings mirror predictably, and degenerate axes stay finite.",
				issues: [44, 133],
				coveredBy: [
					coveredBy(
						"transform-gesture.test.ts",
						"switches between opposite-edge and center math from original bounds",
					),
					coveredBy(
						"transform-gesture.test.ts",
						"mirrors cleanly through the center and protects degenerate axes",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"previews and commits an Alt resize through the mounted handle path",
					),
				],
			},
			{
				id: "transform-rotation",
				expectation:
					"Rotation uses a stable center, normalizes signed angles, Shift-snaps to 15 degrees, and cancels without history.",
				issues: [201],
				coveredBy: [
					coveredBy(
						"transform-gesture.test.ts",
						"snaps Shift rotation to 15 degree increments in both directions",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"restores rotation preview and commits nothing on Escape",
					),
				],
			},
			{
				id: "transform-cursors-history-and-cancel",
				expectation:
					"Handles expose conventional cursors; release creates one atomic edit, while Escape/native cancellation restores the original geometry.",
				issues: [44, 88],
				coveredBy: [
					coveredBy(
						"canvas-cursor.test.ts",
						"maps visible handle directions to conventional resize cursors",
					),
					coveredBy(
						"glyph-canvas-center-transform.test.ts",
						"commits nothing when the native drag end is a pointer cancellation",
					),
				],
			},
		],
	},
] as const satisfies readonly ToolItinerary[]

const FONT_POLICY = {
	yAxis: "up",
	rotationSnapDegrees: 15,
} as const satisfies VectorGesturePolicy

const pointer = (
	x: number,
	y: number,
	options: {
		readonly screenX?: number
		readonly screenY?: number
		readonly shiftKey?: boolean
		readonly altKey?: boolean
		readonly additive?: boolean
	} = {},
) => ({
	world: { x, y },
	rawWorld: { x, y },
	screen: { x: options.screenX ?? x, y: options.screenY ?? y },
	modifiers: {
		shiftKey: options.shiftKey ?? false,
		altKey: options.altKey ?? false,
		additive: options.additive ?? false,
	},
	snaps: [],
})

function reduce(state: VectorGestureState | null, event: VectorGestureEvent) {
	return reduceVectorGesture(state, event, FONT_POLICY)
}

function begin(input: VectorGestureDownInput) {
	return reduce(null, {
		...input,
		type: "pointer-down",
		pointerId: 7,
		pointer: pointer(10, 20),
	} as VectorGestureDown)
}

function keyboardEvent(key: string) {
	return {
		key,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false,
	}
}

function activeLayer(workspace: ReturnType<typeof createEditorWorkspace>) {
	const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
	if (layer === null) throw new Error("Expected an active glyph layer.")
	return layer
}

describe("create-font canvas-tool itinerary", () => {
	it("registers exactly the seven font canvas tools and shortcuts", () => {
		const registered = [
			TOOLS.SELECT,
			TOOLS.PEN,
			TOOLS.RECT,
			TOOLS.ELLIPSE,
			TOOLS.KNIFE,
			TOOLS.RULE,
			TOOLS.TRANSFORM,
		]
		expect(registered.map(({ id }) => id)).toEqual(
			FONT_TOOL_ITINERARY.map(({ tool }) => tool),
		)
		for (const entry of FONT_TOOL_ITINERARY) {
			expect(
				toolForKeyboardEvent(keyboardEvent(entry.shortcut), true)?.id,
			).toBe(entry.tool)
		}
	})

	it("maps every intended behavior to a concrete Vitest assertion", () => {
		const behaviorIds = new Set<string>()
		for (const entry of FONT_TOOL_ITINERARY) {
			expect(entry.behaviors.length).toBeGreaterThan(0)
			for (const behavior of entry.behaviors) {
				expect(behaviorIds.has(behavior.id)).toBe(false)
				behaviorIds.add(behavior.id)
				expect(behavior.issues.length).toBeGreaterThan(0)
				expect(behavior.coveredBy.length).toBeGreaterThan(0)
				for (const reference of behavior.coveredBy) {
					const source = readFileSync(
						new URL(reference.file, import.meta.url),
						"utf8",
					)
					expect(source, `${reference.file}: ${reference.test}`).toContain(
						reference.test,
					)
				}
			}
		}
	})

	it("Select — preserves toggle marquee precedence and snap/commit parity", () => {
		const a = {
			kind: "node",
			pointId: "point:a" as PointId,
		} as const satisfies EditorSelectionTarget
		const b = {
			kind: "node",
			pointId: "point:b" as PointId,
		} as const satisfies EditorSelectionTarget
		const c = {
			kind: "node",
			pointId: "point:c" as PointId,
		} as const satisfies EditorSelectionTarget
		const mode = marqueeSelectionMode({
			shiftKey: true,
			metaKey: true,
			ctrlKey: true,
		})
		expect(mode).toBe("toggle")
		expect(combineMarqueeSelection([a, b], [b, c], mode)).toEqual([a, c])

		const input = {
			pointId: "point:dragged" as PointId,
			anchor: { x: 10, y: 20 },
			candidate: { x: 83, y: 45 },
			shiftKey: true,
			nodes: [{ pointId: "point:snap" as PointId, x: 80, y: 500 }],
			metrics: [],
			worldScale: 1,
			thresholdPixels: 7,
		}
		const preview = resolveGesturePoint(input)
		const commit = resolveGesturePoint(input)
		expect(preview).toMatchObject({ x: 80, y: 20 })
		expect(commit).toEqual(preview)
	})

	it("Pen — preserves y-up click, curve, modifier, and cancellation semantics", () => {
		const click = resolvePenGesture({
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 103, y: 100 },
			worldScale: 2,
		})
		expect(click).toMatchObject({ kind: "click", mode: "hard", handles: null })

		const curve = resolvePenGesture({
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 120, y: 80 },
			worldScale: 0.25,
			shiftKey: true,
		})
		expect(curve.kind).toBe("curve")
		if (curve.kind !== "curve") throw new Error("Expected a Pen curve.")
		expect(curve.handles.incoming.x).toBeCloseTo(-80)
		expect(curve.handles.incoming.y).toBeCloseTo(-80)
		expect(curve.handles.outgoing.x).toBeCloseTo(80)
		expect(curve.handles.outgoing.y).toBeCloseTo(80)

		const started = begin({ tool: "pen" })
		expect(
			reduce(started.state, { type: "pointer-cancel", pointerId: 7 }),
		).toEqual({
			state: null,
			preview: null,
			intent: null,
			canceled: true,
		})
	})

	it("Rectangle — preserves centered constrained geometry", () => {
		const gesture = resolveShapeGesture({
			anchor: { x: 10, y: 20 },
			rawCandidate: { x: 40, y: 50 },
			snappedCandidate: { x: 40, y: 50 },
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 130, y: 130 },
			shiftKey: true,
			altKey: true,
		})
		expect(gesture).toMatchObject({
			valid: true,
			bounds: { minX: -20, minY: -10, maxX: 40, maxY: 50 },
		})
		expect(shapeGeometry("rect", gesture.bounds)).toEqual([
			{ mode: "hard", x: -20, y: 50 },
			{ mode: "hard", x: 40, y: 50 },
			{ mode: "hard", x: 40, y: -10 },
			{ mode: "hard", x: -20, y: -10 },
		])
	})

	it("Ellipse — preserves centered constrained cubic geometry", () => {
		const gesture = resolveShapeGesture({
			anchor: { x: 10, y: 20 },
			rawCandidate: { x: 40, y: 50 },
			snappedCandidate: { x: 40, y: 50 },
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 130, y: 130 },
			shiftKey: true,
			altKey: true,
		})
		const ellipse = shapeGeometry("ellipse", gesture.bounds)
		expect(ellipse).toHaveLength(4)
		expect(ellipse.map(({ mode, x, y }) => ({ mode, x, y }))).toEqual([
			{ mode: "soft", x: 10, y: 50 },
			{ mode: "soft", x: 40, y: 20 },
			{ mode: "soft", x: 10, y: -10 },
			{ mode: "soft", x: -20, y: 20 },
		])
		for (const point of ellipse) {
			expect(point.incoming).toBeDefined()
			expect(point.outgoing).toBeDefined()
		}
	})

	it("Knife — cuts closed and open cubic topology atomically", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(2, oGlyphId)
		const original = activeLayer(workspace)
		const contour = original.contours[0]
		if (contour === undefined) throw new Error("Expected a closed contour.")
		const leftA = "point:itinerary:knife:left-a" as PointId
		const rightA = "point:itinerary:knife:right-a" as PointId
		workspace.font.actions.cutSegment({
			masterId: original.masterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			segmentIndex: 0,
			leftPointId: leftA,
			rightPointId: rightA,
			amount: 0.5,
		})
		const opened = activeLayer(workspace).contours.find(
			({ id }) => id === contour.id,
		)
		if (opened === undefined) throw new Error("Knife cut removed its contour.")
		expect(opened.closed).toBe(false)
		expect(opened.nodes).toHaveLength(contour.nodes.length + 2)
		const leftNode = opened.nodes.find(({ pointId }) => pointId === leftA)
		const rightNode = opened.nodes.find(({ pointId }) => pointId === rightA)
		expect(leftNode?.outgoing).toBeUndefined()
		expect(rightNode?.incoming).toBeUndefined()
		expect({ x: leftNode?.x, y: leftNode?.y }).toEqual({
			x: rightNode?.x,
			y: rightNode?.y,
		})

		const leftB = "point:itinerary:knife:left-b" as PointId
		const rightB = "point:itinerary:knife:right-b" as PointId
		const rightContourId = "contour:itinerary:knife:right" as ContourId
		workspace.font.actions.cutSegment({
			masterId: original.masterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			segmentIndex: 1,
			leftPointId: leftB,
			rightPointId: rightB,
			rightContourId,
			amount: 0.5,
		})
		const split = activeLayer(workspace)
		expect(split.contours.find(({ id }) => id === contour.id)?.closed).toBe(
			false,
		)
		expect(split.contours.find(({ id }) => id === rightContourId)?.closed).toBe(
			false,
		)
		expect(split.contours).toHaveLength(original.contours.length + 1)

		workspace.font.undo(oGlyphId)
		expect(activeLayer(workspace).contours).toHaveLength(
			original.contours.length,
		)
		expect(
			activeLayer(workspace).contours.find(({ id }) => id === contour.id)
				?.closed,
		).toBe(false)
		workspace.font.undo(oGlyphId)
		expect(
			activeLayer(workspace).contours.find(({ id }) => id === contour.id),
		).toEqual(contour)
		workspace.font.redo(oGlyphId)
		workspace.font.redo(oGlyphId)
		expect(activeLayer(workspace).contours).toHaveLength(
			original.contours.length + 1,
		)
	})

	it("Rule — measures form/counterform occupancy and ignores open contours", () => {
		const nodes = (points: readonly (readonly [number, number])[]) =>
			points.map(([x, y]) => ({ x, y }))
		const form = {
			closed: true,
			nodes: nodes([
				[0, 0],
				[0, 100],
				[100, 100],
				[100, 0],
			]),
		}
		const counter = {
			closed: true,
			nodes: nodes([
				[30, 30],
				[70, 30],
				[70, 70],
				[30, 70],
			]),
		}
		const rule = {
			id: "rule:itinerary" as const,
			a: { x: -50, y: 50 },
			b: { x: 150, y: 50 },
		}
		const measured = measureRule(rule, [
			form,
			counter,
			{ ...form, closed: false },
		])
		expect(measured.events.map(({ kind, x }) => [kind, x])).toEqual([
			["entry", 0],
			["exit", 30],
			["entry", 70],
			["exit", 100],
		])
		expect(measured.measures.map(({ label }) => label)).toEqual([
			"30.0",
			"40.0",
			"30.0",
		])
		const constrained = constrainRulePointToAngle(
			{ x: 0, y: 0 },
			{ x: 100, y: 24.9 },
			true,
		)
		expect(
			(Math.atan2(constrained.y, constrained.x) * 180) / Math.PI,
		).toBeCloseTo(15)
	})

	it("Transform — keeps the visual opposite anchor fixed for all eight y-up handles", () => {
		const cases = [
			["nw", { x: 0, y: 80 }, { x: 100, y: 0 }],
			["n", { x: 50, y: 80 }, { x: 50, y: 0 }],
			["ne", { x: 100, y: 80 }, { x: 0, y: 0 }],
			["e", { x: 100, y: 40 }, { x: 0, y: 40 }],
			["se", { x: 100, y: 0 }, { x: 0, y: 80 }],
			["s", { x: 50, y: 0 }, { x: 50, y: 80 }],
			["sw", { x: 0, y: 0 }, { x: 100, y: 80 }],
			["w", { x: 0, y: 40 }, { x: 100, y: 40 }],
		] as const satisfies readonly [
			VectorTransformHandle,
			Readonly<{ x: number; y: number }>,
			Readonly<{ x: number; y: number }>,
		][]
		const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 }
		for (const [handle, start, anchor] of cases) {
			const started = reduceVectorGesture(
				null,
				{
					type: "pointer-down",
					tool: "transform",
					pointerId: 7,
					pointer: pointer(start.x, start.y),
					targetId: "selection",
					bounds,
					handle,
				},
				FONT_POLICY,
			)
			const target = { x: start.x + 20, y: start.y + 10 }
			const moved = reduce(started.state, {
				type: "pointer-move",
				pointerId: 7,
				pointer: pointer(target.x, target.y),
			})
			if (moved.preview?.kind !== "transform")
				throw new Error(`Expected a ${handle} transform preview.`)
			expect(moved.preview.anchor, handle).toEqual(anchor)
			const transformedStart = {
				x: anchor.x + (start.x - anchor.x) * moved.preview.scale.x,
				y: anchor.y + (start.y - anchor.y) * moved.preview.scale.y,
			}
			expect(transformedStart.x, handle).toBeCloseTo(
				handle === "n" || handle === "s" ? start.x : target.x,
			)
			expect(transformedStart.y, handle).toBeCloseTo(
				handle === "e" || handle === "w" ? start.y : target.y,
			)
		}
	})

	it.each([
		["Select", { tool: "select", targetId: null }],
		["Pen", { tool: "pen" }],
		["Rectangle", { tool: "rect" }],
		["Ellipse", { tool: "ellipse" }],
		[
			"Transform",
			{
				tool: "transform",
				targetId: "selection",
				bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
				handle: "se",
			},
		],
	] as const)(
		"%s — reducer-backed pointer cancellation produces no commit",
		(_name, input) => {
			const started = begin(input as VectorGestureDownInput)
			expect(
				reduce(started.state, { type: "pointer-cancel", pointerId: 7 }),
			).toEqual({
				state: null,
				preview: null,
				intent: null,
				canceled: true,
			})
		},
	)
})
