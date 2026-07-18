import { describe, expect, it } from "vitest"

import {
	createFontEditorState,
	evaluateCubicCurve,
	straightSegmentHandles,
	type CreateContourInput,
} from "../src/index.ts"
import {
	blackMasterId,
	makeGeometricOEditorFont,
	notdefGlyphId,
	oGlyphId,
	razorMasterId,
} from "./fixtures/geometric-o.ts"

function createLoadedEditor(key: string) {
	const editor = createFontEditorState({ key })
	editor.actions.load(makeGeometricOEditorFont())
	return editor
}

function makeStraightSegmentFixture(options?: {
	readonly closed?: boolean
	readonly contourIndex?: number
	readonly segmentIndex?: number
}) {
	const source = makeGeometricOEditorFont()
	const glyph = source.glyphs.find((candidate) => candidate.id === oGlyphId)
	const contour = glyph?.contours[options?.contourIndex ?? 1]
	if (glyph === undefined || contour === undefined) {
		throw new Error("Fixture contour is missing.")
	}
	if (options?.closed !== undefined) {
		Object.assign(contour, { closed: options.closed })
	}
	const segmentIndex = options?.segmentIndex ?? 0
	const start = contour.points[segmentIndex]
	const end = contour.closed
		? contour.points[(segmentIndex + 1) % contour.points.length]
		: contour.points[segmentIndex + 1]
	if (start === undefined || end === undefined) {
		throw new Error("Fixture segment is missing.")
	}
	for (const layer of glyph.layers) {
		const startPoint = layer.points.find(
			(point) => point.pointId === start.id,
		) as { outgoing?: { readonly x: number; readonly y: number } } | undefined
		const endPoint = layer.points.find((point) => point.pointId === end.id) as
			| { incoming?: { readonly x: number; readonly y: number } }
			| undefined
		if (startPoint === undefined || endPoint === undefined) {
			throw new Error("Fixture layer segment is missing.")
		}
		delete startPoint.outgoing
		delete endPoint.incoming
	}
	return {
		source,
		contourId: contour.id,
		segmentIndex,
		startPointId: start.id,
		endPointId: end.id,
	}
}

const penContourId = "contour:glyph:O:pen" as const
const penPointIds = [
	"point:glyph:O:pen:0",
	"point:glyph:O:pen:1",
	"point:glyph:O:pen:2",
] as const

const hardPenFirstPoint = {
	mode: "hard",
	coordinates: [
		{ masterId: razorMasterId, x: 200, y: 100 },
		{ masterId: blackMasterId, x: 220, y: 80 },
	],
} as const satisfies Readonly<{
	mode: CreateContourInput["point"]["mode"]
	coordinates: CreateContourInput["coordinates"]
}>

const softPenFirstPoint = {
	mode: "soft",
	coordinates: [
		{
			masterId: razorMasterId,
			x: 200,
			y: 100,
			incoming: { x: -40, y: -20 },
			outgoing: { x: 80, y: 40 },
		},
		{
			masterId: blackMasterId,
			x: 220,
			y: 80,
			incoming: { x: -30, y: 10 },
			outgoing: { x: 60, y: -20 },
		},
	],
} as const satisfies Readonly<{
	mode: CreateContourInput["point"]["mode"]
	coordinates: CreateContourInput["coordinates"]
}>

function createOpenPenContour(
	editor: ReturnType<typeof createLoadedEditor>,
	firstPoint:
		| typeof hardPenFirstPoint
		| typeof softPenFirstPoint = hardPenFirstPoint,
): void {
	editor.actions.createContour({
		glyphId: oGlyphId,
		contourId: penContourId,
		point: { id: penPointIds[0], mode: firstPoint.mode },
		coordinates: firstPoint.coordinates,
	})
	for (const [index, pointId] of penPointIds.slice(1).entries()) {
		editor.actions.insertPoint({
			glyphId: oGlyphId,
			contourId: penContourId,
			point: { id: pointId, mode: "hard" },
			coordinates: [
				{ masterId: razorMasterId, x: 400 + index * 100, y: 300 },
				{ masterId: blackMasterId, x: 430 + index * 110, y: 280 },
			],
		})
	}
}

describe("font editor state", () => {
	it("projects the Razor/Black geometric O through target ingestion", () => {
		const editor = createLoadedEditor("test/compile")
		const compilation = editor.read.compilation()

		expect(compilation.stage).toBe("compiled")
		if (!compilation.ok) return
		expect(compilation.source.axes).toEqual([
			{
				tag: "wght",
				name: "Weight",
				min: 100,
				default: 100,
				max: 900,
				hidden: false,
			},
		])
		expect(compilation.source.glyphs.map((glyph) => glyph.name)).toEqual([
			".notdef",
			"O",
		])
		expect(compilation.source.cmap).toEqual([{ codePoint: 0x4f, glyph: 1 }])

		const glyph = compilation.source.glyphs[1]
		expect(glyph?.contours).toHaveLength(2)
		expect(glyph?.contours.flat()).toHaveLength(16)
		expect(glyph?.variations).toHaveLength(1)
		expect(glyph?.variations[0]?.region).toEqual({ peak: { wght: 1 } })
		expect(glyph?.variations[0]?.deltas.points.slice(0, 8)).toEqual(
			Array.from({ length: 8 }, () => ({ x: 0, y: 0 })),
		)
		expect(glyph?.variations[0]?.deltas.points[8]).toEqual({ x: 0, y: -320 })
		expect(glyph?.variations[0]?.deltas.points[9]).toEqual({ x: 320, y: -320 })
		expect(glyph?.variations[0]?.deltas.phantom).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		})
	})

	it("reports invalid overshoot metadata without passing it to target v1", () => {
		const editor = createFontEditorState({ key: "test/overshoot-projection" })
		const source = makeGeometricOEditorFont()
		editor.actions.load({
			...source,
			metrics: {
				...source.metrics,
				overshoots: { ...source.metrics.overshoots, xHeight: -1 },
			},
		})
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage !== "projection-failed") return
		expect(compilation.projectionErrors).toContainEqual(
			expect.objectContaining({
				code: "metrics.overshoot_range",
				path: "$.metrics.overshoots.xHeight",
			}),
		)
	})

	it("round-trips serializable editor state", () => {
		const source = makeGeometricOEditorFont()
		const editor = createFontEditorState({ key: "test/round-trip" })

		expect(editor.read.editorSource()).toBeNull()
		editor.actions.load(source)
		expect(editor.read.editorSource()).toEqual(source)
	})

	it("keeps documents isolated even when their entity IDs match", () => {
		const first = createLoadedEditor("test/isolation")
		const second = createLoadedEditor("test/isolation")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[1]?.points[1]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		expect(first.atoms.pointPosition.key).toBe("pointPosition")
		expect(second.atoms.pointPosition.key).toBe("pointPosition")

		second.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 777, y: 444 }],
		})

		expect(
			first.silo.getState(first.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toEqual({ x: 460, y: 400 })
		expect(
			second.silo.getState(second.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toEqual({ x: 777, y: 444 })
	})

	it("records a multi-coordinate drag as undoable document history", () => {
		const editor = createLoadedEditor("test/history")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[1]?.points[1]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		let recordedUpdates = 0
		const unsubscribe = editor.silo.subscribe(
			editor.transactions.movePoints,
			(event) => {
				recordedUpdates = event.subEvents.length
			},
		)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 700, y: 350 }],
		})
		expect(
			editor.silo.getState(editor.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toEqual({ x: 700, y: 350 })
		expect(recordedUpdates).toBe(1)
		unsubscribe()

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toEqual({ x: 460, y: 400 })

		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toEqual({ x: 700, y: 350 })
	})

	it("pastes complete multi-master contours as one undoable glyph edit", () => {
		const editor = createLoadedEditor("test/paste-contours")
		const contourId = "contour:pasted" as const
		const firstPointId = "point:pasted:first" as const
		const secondPointId = "point:pasted:second" as const

		editor.actions.pasteContours({
			glyphId: oGlyphId,
			contours: [
				{
					id: contourId,
					closed: false,
					points: [
						{ id: firstPointId, mode: "hard" },
						{ id: secondPointId, mode: "hard" },
					],
				},
			],
			layers: [
				{
					masterId: razorMasterId,
					points: [
						{ pointId: firstPointId, x: 10, y: 20, outgoing: { x: 30, y: 0 } },
						{
							pointId: secondPointId,
							x: 100,
							y: 20,
							incoming: { x: -30, y: 0 },
						},
					],
				},
				{
					masterId: blackMasterId,
					points: [
						{ pointId: firstPointId, x: 15, y: 25, outgoing: { x: 35, y: 0 } },
						{
							pointId: secondPointId,
							x: 120,
							y: 25,
							incoming: { x: -35, y: 0 },
						},
					],
				},
			],
		})

		expect(editor.read.editorGlyphSource(oGlyphId)?.contours.at(-1)).toEqual({
			id: contourId,
			closed: false,
			points: [
				{ id: firstPointId, mode: "hard" },
				{ id: secondPointId, mode: "hard" },
			],
		})
		expect(
			editor.read.layerNode(blackMasterId, oGlyphId, firstPointId),
		).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({
					x: 15,
					y: 25,
					outgoing: { x: 35, y: 0 },
				}),
			}),
		)

		editor.undo(oGlyphId)
		expect(
			editor.read.editorGlyphSource(oGlyphId)?.contours,
		).not.toContainEqual(expect.objectContaining({ id: contourId }))
		editor.redo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)?.contours.at(-1)?.id).toBe(
			contourId,
		)
	})

	it("creates one validated complete contour across masters as one edit", () => {
		const editor = createLoadedEditor("test/create-complete-contour")
		const contourId = "contour:shape" as const
		const pointIds = [
			"point:shape:0",
			"point:shape:1",
			"point:shape:2",
			"point:shape:3",
		] as const
		let transactionEvents = 0
		const unsubscribe = editor.silo.subscribe(
			editor.transactions.createCompleteContour,
			() => {
				transactionEvents += 1
			},
		)
		const revision = editor.silo.getState(editor.atoms.documentRevision)

		editor.actions.createCompleteContour({
			glyphId: oGlyphId,
			contour: {
				id: contourId,
				closed: true,
				points: pointIds.map((id) => ({ id, mode: "hard" })),
			},
			layers: [razorMasterId, blackMasterId].map((masterId, layerIndex) => ({
				masterId,
				points: pointIds.map((pointId, index) => ({
					pointId,
					x: layerIndex * 10 + (index === 1 || index === 2 ? 100 : 0),
					y: index < 2 ? 200 : 0,
				})),
			})),
		})
		unsubscribe()

		expect(transactionEvents).toBe(1)
		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(
			revision + 1,
		)
		expect(editor.read.editorGlyphSource(oGlyphId)?.contours.at(-1)).toEqual({
			id: contourId,
			closed: true,
			points: pointIds.map((id) => ({ id, mode: "hard" })),
		})
		for (const masterId of [razorMasterId, blackMasterId]) {
			for (const pointId of pointIds) {
				expect(editor.read.layerNode(masterId, oGlyphId, pointId).ok).toBe(true)
			}
		}

		editor.undo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.contours.some((contour) => contour.id === contourId),
		).toBe(false)
		editor.redo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)?.contours.at(-1)?.id).toBe(
			contourId,
		)
		expect(editor.read.compilation().ok).toBe(true)
	})

	it("rolls back invalid complete-contour input before mutating the glyph", () => {
		const editor = createLoadedEditor("test/create-complete-contour-invalid")
		const before = editor.read.editorSource()
		expect(() =>
			editor.actions.createCompleteContour({
				glyphId: oGlyphId,
				contour: {
					id: "contour:shape:invalid",
					closed: true,
					points: [
						{ id: "point:shape:invalid:0", mode: "soft" },
						{ id: "point:shape:invalid:1", mode: "soft" },
						{ id: "point:shape:invalid:2", mode: "soft" },
					],
				},
				layers: [
					{
						masterId: razorMasterId,
						points: [
							{ pointId: "point:shape:invalid:0", x: 0, y: 0 },
							{ pointId: "point:shape:invalid:1", x: 10, y: 0 },
							{ pointId: "point:shape:invalid:2", x: 0, y: 10 },
						],
					},
				],
			}),
		).toThrow("every glyph layer")
		expect(editor.read.editorSource()).toBe(before)
	})

	it("rejects incomplete pasted master data before changing a glyph", () => {
		const editor = createLoadedEditor("test/paste-contours-incomplete")
		const before = editor.read.editorGlyphSource(oGlyphId)
		expect(() =>
			editor.actions.pasteContours({
				glyphId: oGlyphId,
				contours: [
					{
						id: "contour:incomplete",
						closed: false,
						points: [{ id: "point:incomplete", mode: "hard" }],
					},
				],
				layers: [
					{
						masterId: razorMasterId,
						points: [{ pointId: "point:incomplete", x: 10, y: 20 }],
					},
				],
			}),
		).toThrow("every destination glyph layer")
		expect(editor.read.editorGlyphSource(oGlyphId)).toBe(before)
	})

	it("authors dangling Pen handles across masters as one endpoint history edit", () => {
		const editor = createLoadedEditor("test/author-pen-endpoint")
		const contourId = "contour:pen-endpoint" as const
		const firstPointId = "point:pen-endpoint:first" as const
		const lastPointId = "point:pen-endpoint:last" as const
		editor.actions.pasteContours({
			glyphId: oGlyphId,
			contours: [
				{
					id: contourId,
					closed: false,
					points: [
						{ id: firstPointId, mode: "hard" },
						{ id: lastPointId, mode: "soft" },
					],
				},
			],
			layers: [
				{
					masterId: razorMasterId,
					points: [
						{ pointId: firstPointId, x: 0, y: 0 },
						{
							pointId: lastPointId,
							x: 100,
							y: 0,
							incoming: { x: -30, y: 0 },
							outgoing: { x: 20, y: 0 },
						},
					],
				},
				{
					masterId: blackMasterId,
					points: [
						{ pointId: firstPointId, x: 0, y: 10 },
						{
							pointId: lastPointId,
							x: 120,
							y: 10,
							incoming: { x: -45, y: 0 },
							outgoing: { x: 25, y: 0 },
						},
					],
				},
			],
		})
		editor.clearHistory(oGlyphId)
		editor.actions.authorPenEndpoint({
			glyphId: oGlyphId,
			contourId,
			pointId: lastPointId,
			forwardHandle: "outgoing",
			mode: "soft",
			coordinates: [
				{ masterId: razorMasterId, forward: { x: 0, y: 50 } },
				{ masterId: blackMasterId, forward: { x: 0, y: 60 } },
			],
		})
		expect(editor.read.layerNode(razorMasterId, oGlyphId, lastPointId)).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({
					mode: "soft",
					incoming: { x: 0, y: -30 },
					outgoing: { x: 0, y: 50 },
				}),
			}),
		)
		expect(editor.read.layerNode(blackMasterId, oGlyphId, lastPointId)).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({
					incoming: { x: 0, y: -45 },
					outgoing: { x: 0, y: 60 },
				}),
			}),
		)

		editor.undo(oGlyphId)
		expect(editor.read.layerNode(razorMasterId, oGlyphId, lastPointId)).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({
					incoming: { x: -30, y: 0 },
					outgoing: { x: 20, y: 0 },
				}),
			}),
		)
		editor.redo(oGlyphId)
		expect(editor.read.layerNode(razorMasterId, oGlyphId, lastPointId)).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({ outgoing: { x: 0, y: 50 } }),
			}),
		)
	})

	it("hardens clicked soft endpoints and clears only their forward handles atomically", () => {
		const cases = [
			{
				label: "first",
				side: "first",
				pointId: "point:pen-click:first",
				otherPointId: "point:pen-click:first:other",
				forwardHandle: "incoming",
				connectedHandle: "outgoing",
				razorEndpoint: {
					pointId: "point:pen-click:first",
					x: 0,
					y: 0,
					incoming: { x: -20, y: 5 },
					outgoing: { x: 30, y: -7 },
				},
				blackEndpoint: {
					pointId: "point:pen-click:first",
					x: 0,
					y: 10,
					incoming: { x: -25, y: 8 },
				},
			},
			{
				label: "last",
				side: "last",
				pointId: "point:pen-click:last",
				otherPointId: "point:pen-click:last:other",
				forwardHandle: "outgoing",
				connectedHandle: "incoming",
				razorEndpoint: {
					pointId: "point:pen-click:last",
					x: 100,
					y: 0,
					incoming: { x: -30, y: 7 },
					outgoing: { x: 20, y: -5 },
				},
				blackEndpoint: {
					pointId: "point:pen-click:last",
					x: 120,
					y: 10,
					incoming: { x: -45, y: 9 },
				},
			},
		] as const

		for (const testCase of cases) {
			const editor = createLoadedEditor(
				`test/pen-click-harden-${testCase.label}`,
			)
			const contourId = `contour:pen-click:${testCase.label}`
			const points =
				testCase.side === "first"
					? [
							{ id: testCase.pointId, mode: "soft" as const },
							{ id: testCase.otherPointId, mode: "hard" as const },
						]
					: [
							{ id: testCase.otherPointId, mode: "hard" as const },
							{ id: testCase.pointId, mode: "soft" as const },
						]
			const layerPoints = (
				endpoint: typeof testCase.razorEndpoint | typeof testCase.blackEndpoint,
			) =>
				testCase.side === "first"
					? [
							endpoint,
							{ pointId: testCase.otherPointId, x: 100, y: endpoint.y },
						]
					: [{ pointId: testCase.otherPointId, x: 0, y: endpoint.y }, endpoint]
			editor.actions.pasteContours({
				glyphId: oGlyphId,
				contours: [{ id: contourId, closed: false, points }],
				layers: [
					{
						masterId: razorMasterId,
						points: layerPoints(testCase.razorEndpoint),
					},
					{
						masterId: blackMasterId,
						points: layerPoints(testCase.blackEndpoint),
					},
				],
			})
			editor.clearHistory(oGlyphId)
			const before = new Map(
				[razorMasterId, blackMasterId].map((masterId) => [
					masterId,
					editor.read.layerNode(masterId, oGlyphId, testCase.pointId),
				]),
			)

			editor.actions.authorPenEndpoint({
				glyphId: oGlyphId,
				contourId,
				pointId: testCase.pointId,
				forwardHandle: testCase.forwardHandle,
				mode: "hard",
				coordinates: [
					{ masterId: razorMasterId, forward: null },
					{ masterId: blackMasterId, forward: null },
				],
			})

			const committed = new Map()
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				const node = editor.read.layerNode(masterId, oGlyphId, testCase.pointId)
				expect(node.ok).toBe(true)
				if (!node.ok) continue
				expect(node.value.mode).toBe("hard")
				expect(node.value[testCase.forwardHandle]).toBeUndefined()
				const beforeNode = before.get(masterId)
				if (beforeNode?.ok) {
					expect(node.value[testCase.connectedHandle]).toEqual(
						beforeNode.value[testCase.connectedHandle],
					)
				}
				committed.set(masterId, node)
			}
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
			).toMatchObject({ at: 1, length: 1 })

			editor.undo(oGlyphId)
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				expect(
					editor.read.layerNode(masterId, oGlyphId, testCase.pointId),
				).toEqual(before.get(masterId))
			}
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
			).toMatchObject({ at: 0, length: 1 })

			editor.redo(oGlyphId)
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				expect(
					editor.read.layerNode(masterId, oGlyphId, testCase.pointId),
				).toEqual(committed.get(masterId))
			}
		}
	})

	it("edits advance width in glyph history while deriving the sidebearing", () => {
		const editor = createLoadedEditor("test/horizontal-metrics")
		const before = editor.read
			.editorSource()
			?.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		if (before === undefined) throw new Error("Missing fixture layer.")

		editor.actions.setHorizontalMetrics({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			advanceWidth: before.advanceWidth + 40,
		})
		const changed = editor.read
			.editorSource()
			?.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		expect(changed).toMatchObject({
			advanceWidth: before.advanceWidth + 40,
			leftSideBearing: before.leftSideBearing,
		})

		editor.undo(oGlyphId)
		const undone = editor.read
			.editorSource()
			?.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		expect(undone).toMatchObject({
			advanceWidth: before.advanceWidth,
			leftSideBearing: before.leftSideBearing,
		})
		editor.redo(oGlyphId)
		expect(
			editor.read
				.editorSource()
				?.glyphs.find((glyph) => glyph.id === oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId),
		).toMatchObject({
			advanceWidth: before.advanceWidth + 40,
			leftSideBearing: before.leftSideBearing,
		})
	})

	it("rejects horizontal metrics outside their storage domains", () => {
		const editor = createLoadedEditor("test/horizontal-metric-bounds")
		expect(() =>
			editor.actions.setHorizontalMetrics({
				masterId: razorMasterId,
				glyphId: oGlyphId,
				advanceWidth: 65_536,
			}),
		).toThrow(/0 through 65535/u)
	})

	it("derives each master sidebearing from translated outline geometry", () => {
		const editor = createLoadedEditor("test/derived-sidebearings")
		const source = editor.read.editorGlyphSource(oGlyphId)
		if (source === null) throw new Error("Missing fixture glyph.")
		const pointIds = source.contours.flatMap((contour) =>
			contour.points.map((point) => point.id),
		)
		const before = source.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)
		if (before === undefined) throw new Error("Missing fixture layer.")
		editor.actions.movePoints({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			points: before.points.map((point) => ({
				pointId: point.pointId,
				x: point.x + 37,
				y: point.y,
			})),
		})
		const after = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		expect(after?.leftSideBearing).toBeCloseTo(before.leftSideBearing + 37)
		const compiled = editor.read.glyphLayer(razorMasterId, oGlyphId)
		expect(compiled.ok).toBe(true)
		if (compiled.ok) {
			expect(compiled.value.leftSideBearing).toBe(compiled.value.xMin)
		}
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)
				?.leftSideBearing,
		).toBe(
			source.layers.find((layer) => layer.masterId === blackMasterId)
				?.leftSideBearing,
		)
		expect(pointIds).toHaveLength(before.points.length)
		editor.undo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId)
				?.leftSideBearing,
		).toBe(before.leftSideBearing)
		editor.redo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId)
				?.leftSideBearing,
		).toBeCloseTo(before.leftSideBearing + 37)
	})

	it("treats loaded sidebearings as compatibility data, not editor state", () => {
		const source = makeGeometricOEditorFont()
		const layer = source.glyphs
			.find((glyph) => glyph.id === oGlyphId)
			?.layers.find((candidate) => candidate.masterId === razorMasterId)
		if (layer === undefined) throw new Error("Missing fixture layer.")
		Object.assign(layer, { leftSideBearing: -12_345 })
		const editor = createFontEditorState({ key: "test/legacy-sidebearing" })
		editor.actions.load(source)
		const serialized = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((candidate) => candidate.masterId === razorMasterId)
		expect(serialized?.leftSideBearing).not.toBe(-12_345)
		const compiled = editor.read.glyphLayer(razorMasterId, oGlyphId)
		expect(compiled.ok).toBe(true)
		if (compiled.ok) {
			expect(compiled.value.leftSideBearing).toBe(compiled.value.xMin)
		}
	})

	it("writes LSB by translating one master outline as a single history edit", () => {
		const editor = createLoadedEditor("test/writable-lsb")
		const before = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		const rightSideBearing = editor.silo.getState(
			editor.selectors.rightSideBearing,
			[razorMasterId, oGlyphId],
		)
		if (before === undefined || rightSideBearing === null) {
			throw new Error("Missing fixture layer metrics.")
		}
		editor.silo.setState(
			editor.selectors.leftSideBearing,
			[razorMasterId, oGlyphId],
			before.leftSideBearing + 25,
		)
		const after = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		expect(after?.leftSideBearing).toBeCloseTo(before.leftSideBearing + 25)
		expect(after?.advanceWidth).toBeCloseTo(before.advanceWidth + 25)
		expect(
			editor.silo.getState(editor.selectors.rightSideBearing, [
				razorMasterId,
				oGlyphId,
			]),
		).toBeCloseTo(rightSideBearing)
		expect(after?.points).toEqual(
			before.points.map((point) => ({ ...point, x: point.x + 25 })),
		)
		editor.undo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId),
		).toEqual(before)
	})

	it("writes RSB through advance width without moving the outline", () => {
		const editor = createLoadedEditor("test/writable-rsb")
		const before = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		const rightSideBearing = editor.silo.getState(
			editor.selectors.rightSideBearing,
			[razorMasterId, oGlyphId],
		)
		if (before === undefined || rightSideBearing === null) {
			throw new Error("Missing fixture layer metrics.")
		}
		editor.silo.setState(
			editor.selectors.rightSideBearing,
			[razorMasterId, oGlyphId],
			rightSideBearing + 30,
		)
		const after = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		expect(
			editor.silo.getState(editor.selectors.rightSideBearing, [
				razorMasterId,
				oGlyphId,
			]),
		).toBeCloseTo(rightSideBearing + 30)
		expect(after?.advanceWidth).toBeCloseTo(before.advanceWidth + 30)
		expect(after?.points).toEqual(before.points)
		editor.undo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId),
		).toEqual(before)
	})

	it("keeps one independent timeline per glyph", () => {
		const editor = createLoadedEditor("test/glyph-histories")
		const source = makeGeometricOEditorFont()
		const oPointId = source.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.contours[0]?.points[0]?.id
		const notdefPointId = source.glyphs.find(
			(glyph) => glyph.id === notdefGlyphId,
		)?.contours[0]?.points[0]?.id
		if (oPointId === undefined || notdefPointId === undefined) {
			throw new Error("Fixture points are missing.")
		}
		let oLength = 0
		let notdefLength = 0
		editor.silo.subscribe(editor.glyphHistoryTimelines, oGlyphId, (update) => {
			oLength = update.length
		})
		editor.silo.subscribe(
			editor.glyphHistoryTimelines,
			notdefGlyphId,
			(update) => {
				notdefLength = update.length
			},
		)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: oPointId, x: 510, y: 810 }],
		})
		expect(oLength).toBe(1)
		expect(notdefLength).toBe(0)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: notdefGlyphId,
			points: [{ pointId: notdefPointId, x: 520, y: 800 }],
		})
		expect(oLength).toBe(1)
		expect(notdefLength).toBe(1)

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointPosition, [
				blackMasterId,
				notdefGlyphId,
				notdefPointId,
			]),
		).toEqual({ x: 520, y: 800 })
	})

	it("keeps relative handles anchored when their owning node moves", () => {
		const editor = createLoadedEditor("test/anchored-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!before.ok) throw new Error("Fixture layer node did not project.")

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: before.value.x + 125, y: before.value.y - 75 }],
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok) throw new Error("Moved layer node did not project.")
		expect(after.value.incoming).toEqual(before.value.incoming)
		expect(after.value.outgoing).toEqual(before.value.outgoing)
		expect(after.value.x).toBe(before.value.x + 125)
		expect(after.value.y).toBe(before.value.y - 75)
	})

	it("moves soft handles as one line while preserving the opposite length", () => {
		const editor = createLoadedEditor("test/soft-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!before.ok || before.value.incoming === undefined) {
			throw new Error("Fixture incoming handle is missing.")
		}
		const oppositeLength = Math.hypot(
			before.value.incoming.x,
			before.value.incoming.y,
		)

		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 0, y: 200 },
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok) throw new Error("Edited layer node did not project.")
		expect(after.value.outgoing).toEqual({ x: 0, y: 200 })
		expect(after.value.incoming?.x).toBeCloseTo(0)
		expect(after.value.incoming?.y).toBeCloseTo(-oppositeLength)
		expect(
			Math.hypot(after.value.incoming?.x ?? 0, after.value.incoming?.y ?? 0),
		).toBeCloseTo(oppositeLength)
	})

	it("keeps hard handles independent and softens every master atomically", () => {
		const editor = createLoadedEditor("test/hard-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
			const hard = editor.read.layerNode(masterId, oGlyphId, pointId)
			if (!hard.ok) throw new Error("Hard layer node did not project.")
			expect(hard.value.mode).toBe("hard")
			expect(hard.value.incoming).toBeDefined()
			expect(hard.value.outgoing).toBeUndefined()
		}

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const soft = editor.read.layerNode(masterId, oGlyphId, pointId)
			if (!soft.ok || soft.value.incoming === undefined) {
				throw new Error("Soft layer node did not project.")
			}
			expect(soft.value.mode).toBe("soft")
			expect(soft.value.outgoing).toBeUndefined()
		}
	})

	it("deletes one handle independently and hardens its node", () => {
		const editor = createLoadedEditor("test/delete-handle")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [],
			handles: [{ pointId, handle: "incoming" }],
		})

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!node.ok) throw new Error("Edited layer node did not project.")
		expect(node.value.mode).toBe("hard")
		expect(node.value.incoming).toBeUndefined()
		expect(node.value.outgoing).toBeDefined()
	})

	it("keeps a one-sided smooth node one-sided and projects its handle onto the tangent", () => {
		const editor = createLoadedEditor("test/soften-one-sided")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		const nextPointId = contour?.points[1]?.id
		if (pointId === undefined || nextPointId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
		}
		const hard = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!hard.ok || hard.value.incoming === undefined) {
			throw new Error("One-sided hard node did not project.")
		}
		const originalLength = Math.hypot(
			hard.value.incoming.x,
			hard.value.incoming.y,
		)

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const next = editor.read.layerNode(blackMasterId, oGlyphId, nextPointId)
		if (!node.ok || !next.ok || node.value.incoming === undefined) {
			throw new Error("Softened layer nodes did not project.")
		}
		expect(node.value.mode).toBe("soft")
		expect(node.value.outgoing).toBeUndefined()
		const tangent = {
			x: next.value.x + (next.value.incoming?.x ?? 0) - node.value.x,
			y: next.value.y + (next.value.incoming?.y ?? 0) - node.value.y,
		}
		expect(
			node.value.incoming.x * tangent.y - node.value.incoming.y * tangent.x,
		).toBeCloseTo(0)
		expect(
			node.value.incoming.x * tangent.x + node.value.incoming.y * tangent.y,
		).toBeLessThanOrEqual(0)
		expect(
			Math.hypot(node.value.incoming.x, node.value.incoming.y),
		).toBeCloseTo(originalLength)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: node.value.x + 60, y: node.value.y - 40 }],
		})
		const moved = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const nextAfterMove = editor.read.layerNode(
			blackMasterId,
			oGlyphId,
			nextPointId,
		)
		if (!moved.ok || !nextAfterMove.ok || moved.value.incoming === undefined) {
			throw new Error("Moved one-sided soft node did not project.")
		}
		const movedTangent = {
			x:
				nextAfterMove.value.x +
				(nextAfterMove.value.incoming?.x ?? 0) -
				moved.value.x,
			y:
				nextAfterMove.value.y +
				(nextAfterMove.value.incoming?.y ?? 0) -
				moved.value.y,
		}
		expect(
			moved.value.incoming.x * movedTangent.y -
				moved.value.incoming.y * movedTangent.x,
		).toBeCloseTo(0)
		expect(
			Math.hypot(moved.value.incoming.x, moved.value.incoming.y),
		).toBeCloseTo(originalLength)
		expect(moved.value.incoming).not.toEqual(node.value.incoming)
	})

	it("projects a sole outgoing handle without adding an incoming handle", () => {
		const editor = createLoadedEditor("test/soften-outgoing-only")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		const previousPointId = contour?.points.at(-1)?.id
		if (pointId === undefined || previousPointId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: null,
			})
		}
		const hard = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!hard.ok || hard.value.outgoing === undefined) {
			throw new Error("One-sided hard node did not project.")
		}
		const originalLength = Math.hypot(
			hard.value.outgoing.x,
			hard.value.outgoing.y,
		)

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const previous = editor.read.layerNode(
			blackMasterId,
			oGlyphId,
			previousPointId,
		)
		if (!node.ok || !previous.ok || node.value.outgoing === undefined) {
			throw new Error("Softened layer nodes did not project.")
		}
		expect(node.value.mode).toBe("soft")
		expect(node.value.incoming).toBeUndefined()
		const awayFromPreviousControl = {
			x: node.value.x - (previous.value.x + (previous.value.outgoing?.x ?? 0)),
			y: node.value.y - (previous.value.y + (previous.value.outgoing?.y ?? 0)),
		}
		expect(
			node.value.outgoing.x * awayFromPreviousControl.y -
				node.value.outgoing.y * awayFromPreviousControl.x,
		).toBeCloseTo(0)
		expect(
			node.value.outgoing.x * awayFromPreviousControl.x +
				node.value.outgoing.y * awayFromPreviousControl.y,
		).toBeGreaterThanOrEqual(0)
		expect(
			Math.hypot(node.value.outgoing.x, node.value.outgoing.y),
		).toBeCloseTo(originalLength)
	})

	it("keeps a handleless node hard when asked to soften it", () => {
		const editor = createLoadedEditor("test/soften-handleless")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")

		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: null,
			})
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const handleless = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!handleless.ok) throw new Error("Handleless node did not project.")
		expect(handleless.value.mode).toBe("hard")
	})

	it("deletes nodes while keeping a contour closed by default", () => {
		const editor = createLoadedEditor("test/delete-node-closed")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[1]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [pointId],
			handles: [],
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(3)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(true)
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("breaks deleted node regions into open loose-ended paths and undoes atomically", () => {
		const editor = createLoadedEditor("test/delete-node-open")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[1]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [pointId],
			handles: [],
			breakPaths: true,
		})

		const remaining = editor.silo.getState(editor.atoms.contourPointIds, [
			oGlyphId,
			contour.id,
		])
		expect(remaining).toHaveLength(3)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(false)
		const firstPointId = remaining?.[0]
		const lastPointId = remaining?.at(-1)
		if (firstPointId === undefined || lastPointId === undefined) {
			throw new Error("Broken path endpoints are missing.")
		}
		const first = editor.read.layerNode(blackMasterId, oGlyphId, firstPointId)
		const last = editor.read.layerNode(blackMasterId, oGlyphId, lastPointId)
		if (!first.ok || !last.ok)
			throw new Error("Broken endpoints did not project.")
		expect(first.value.incoming).toBeUndefined()
		expect(last.value.outgoing).toBeUndefined()
		expect(first.value.mode).toBe("hard")
		expect(last.value.mode).toBe("hard")
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage === "projection-failed") {
			expect(compilation.projectionErrors).toContainEqual(
				expect.objectContaining({ code: "topology.open_contour" }),
			)
		}

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(4)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(true)
	})

	it.each([
		["outgoing", 0, [1, 2, 3, 0]],
		["incoming", 0, [0, 1, 2, 3]],
	] as const)(
		"breaks a deleted %s handle's segment and clears both loose ends",
		(handle, selectedIndex, expectedIndexes) => {
			const editor = createLoadedEditor(`test/delete-${handle}-handle-open`)
			const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
			const pointId = contour?.points[selectedIndex]?.id
			if (contour === undefined || pointId === undefined) {
				throw new Error("Fixture contour is missing.")
			}

			editor.actions.deleteSelection({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointIds: [],
				handles: [{ pointId, handle }],
				breakPaths: true,
			})

			const remaining = editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			])
			expect(remaining).toEqual(
				expectedIndexes.map((index) => contour.points[index]?.id),
			)
			expect(
				editor.silo.getState(editor.atoms.contourClosed, [
					oGlyphId,
					contour.id,
				]),
			).toBe(false)
			const firstPointId = remaining?.[0]
			const lastPointId = remaining?.at(-1)
			if (firstPointId === undefined || lastPointId === undefined) {
				throw new Error("Broken path endpoints are missing.")
			}
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				const first = editor.read.layerNode(masterId, oGlyphId, firstPointId)
				const last = editor.read.layerNode(masterId, oGlyphId, lastPointId)
				if (!first.ok || !last.ok) {
					throw new Error("Broken endpoints did not project.")
				}
				expect(first.value.incoming).toBeUndefined()
				expect(last.value.outgoing).toBeUndefined()
			}

			editor.undo(oGlyphId)
			expect(
				editor.silo.getState(editor.atoms.contourPointIds, [
					oGlyphId,
					contour.id,
				]),
			).toEqual(contour.points.map((point) => point.id))
			expect(
				editor.silo.getState(editor.atoms.contourClosed, [
					oGlyphId,
					contour.id,
				]),
			).toBe(true)
		},
	)

	it("splits disjoint deleted regions into separate open contours", () => {
		const editor = createLoadedEditor("test/delete-disjoint-regions")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const firstPointId = contour?.points[0]?.id
		const thirdPointId = contour?.points[2]?.id
		if (
			contour === undefined ||
			firstPointId === undefined ||
			thirdPointId === undefined
		) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [firstPointId, thirdPointId],
			handles: [],
			breakPaths: true,
		})

		const contourIds = editor.silo.getState(
			editor.atoms.glyphContourIds,
			oGlyphId,
		)
		expect(contourIds).toHaveLength(3)
		const splitContours = contourIds?.slice(0, 2) ?? []
		expect(
			splitContours.map((contourId) =>
				editor.silo.getState(editor.atoms.contourPointIds, [
					oGlyphId,
					contourId,
				]),
			),
		).toEqual([[contour.points[1]?.id], [contour.points[3]?.id]])
		expect(
			splitContours.map((contourId) =>
				editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contourId]),
			),
		).toEqual([false, false])

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
		).toHaveLength(2)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(4)
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
		).toHaveLength(3)
	})

	it("projects and serializes a raw one-sided soft handle", () => {
		const editor = createLoadedEditor("test/raw-soft-invariant")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const atomKey = [blackMasterId, oGlyphId, pointId] as const
		editor.silo.setState(editor.atoms.outgoingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleY, atomKey, null)

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(node.ok).toBe(true)
		if (!node.ok) return
		expect(node.value.mode).toBe("soft")
		expect(node.value.incoming).toBeDefined()
		expect(node.value.outgoing).toBeUndefined()
		expect(editor.read.editorSource()).not.toBeNull()
		expect(editor.read.compilation().stage).not.toBe("projection-failed")
	})

	it("diagnoses a raw handleless soft node instead of serializing it", () => {
		const editor = createLoadedEditor("test/raw-handleless-soft-invariant")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const atomKey = [blackMasterId, oGlyphId, pointId] as const
		editor.silo.setState(editor.atoms.incomingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.incomingHandleY, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleY, atomKey, null)

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(node.ok).toBe(false)
		if (!node.ok) {
			expect(node.errors).toContainEqual(
				expect.objectContaining({ code: "curve.soft_handle_pair" }),
			)
		}
		expect(editor.read.editorSource()).toBeNull()
		expect(editor.read.compilation().stage).toBe("projection-failed")
	})

	it("coordinates cubic-to-quadratic subdivision topology across masters", () => {
		const editor = createLoadedEditor("test/cubic-plan")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 700, y: -900 },
		})

		const plan = editor.silo.getState(editor.selectors.curveSegmentPlan, [
			oGlyphId,
			contour.id,
			0,
		])
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.value.subdivisionDepth).toBeGreaterThan(0)
		expect(plan.value.maximumError).toBeLessThanOrEqual(0.5)
		const razor = editor.read.glyphLayer(razorMasterId, oGlyphId)
		const black = editor.read.glyphLayer(blackMasterId, oGlyphId)
		expect(razor.ok).toBe(true)
		expect(black.ok).toBe(true)
		if (!razor.ok || !black.ok) return
		expect(razor.value.flattenedPoints).toHaveLength(
			black.value.flattenedPoints.length,
		)
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("reports a typed projection error when the fixed curve bound cannot fit", () => {
		const editor = createLoadedEditor("test/cubic-limit")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 1_000_000_000_000, y: 0 },
		})

		const plan = editor.silo.getState(editor.selectors.curveSegmentPlan, [
			oGlyphId,
			contour.id,
			0,
		])
		expect(plan.ok).toBe(false)
		if (plan.ok) return
		expect(plan.errors).toContainEqual(
			expect.objectContaining({ code: "curve.approximation_limit" }),
		)
	})

	it("inserts one shared point with coordinates in every layer", () => {
		const editor = createLoadedEditor("test/insert")
		const contourId = makeGeometricOEditorFont().glyphs[1]?.contours[0]?.id
		if (contourId === undefined) throw new Error("Fixture contour is missing.")

		editor.actions.insertPoint({
			glyphId: oGlyphId,
			contourId,
			at: 1,
			point: { id: "point:glyph:O:inserted", mode: "hard" },
			coordinates: [
				{ masterId: razorMasterId, x: 700, y: 800 },
				{ masterId: blackMasterId, x: 700, y: 800 },
			],
		})

		const inserted = editor.silo.getState(editor.atoms.contourPointIds, [
			oGlyphId,
			contourId,
		])
		expect(inserted?.[1]).toBe("point:glyph:O:inserted")
		expect(editor.read.compilation().stage).toBe("compiled")

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: "point:glyph:O:inserted", x: 733, y: 811 }],
		})
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointPosition, [
				blackMasterId,
				oGlyphId,
				"point:glyph:O:inserted",
			]),
		).toEqual({ x: 700, y: 800 })
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).toContain("point:glyph:O:inserted")

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).not.toContain("point:glyph:O:inserted")
	})

	it("creates hard and valid soft contour points across every master", () => {
		const hardEditor = createLoadedEditor("test/create-hard-contour")
		createOpenPenContour(hardEditor)
		expect(
			hardEditor.silo.getState(hardEditor.atoms.point, [
				oGlyphId,
				penPointIds[0],
			]),
		).toEqual({ mode: "hard" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const node = hardEditor.read.layerNode(masterId, oGlyphId, penPointIds[0])
			expect(node).toMatchObject({ ok: true, value: { mode: "hard" } })
			if (!node.ok) continue
			expect(node.value.incoming).toBeUndefined()
			expect(node.value.outgoing).toBeUndefined()
		}

		const softEditor = createLoadedEditor("test/create-soft-contour")
		createOpenPenContour(softEditor, softPenFirstPoint)
		expect(
			softEditor.silo.getState(softEditor.atoms.point, [
				oGlyphId,
				penPointIds[0],
			]),
		).toEqual({ mode: "soft" })
		for (const coordinate of softPenFirstPoint.coordinates) {
			const node = softEditor.read.layerNode(
				coordinate.masterId,
				oGlyphId,
				penPointIds[0],
			)
			expect(node).toMatchObject({
				ok: true,
				value: {
					mode: "soft",
					incoming: coordinate.incoming,
					outgoing: coordinate.outgoing,
				},
			})
		}
	})

	it("rejects invalid soft contour creation without partial mutation", () => {
		const expectRejected = (
			key: string,
			coordinates: CreateContourInput["coordinates"],
		): void => {
			const editor = createLoadedEditor(`test/create-soft-${key}`)
			const before = editor.read.editorSource()
			expect(() =>
				editor.actions.createContour({
					glyphId: oGlyphId,
					contourId: penContourId,
					point: { id: penPointIds[0], mode: "soft" },
					coordinates,
				}),
			).toThrow()
			expect(editor.read.editorSource()).toEqual(before)
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
			).toMatchObject({ at: 0, length: 0 })
		}

		expectRejected("handleless", hardPenFirstPoint.coordinates)
		expectRejected("unaligned", [
			{
				masterId: razorMasterId,
				x: 200,
				y: 100,
				incoming: { x: -20, y: 0 },
				outgoing: { x: 0, y: 20 },
			},
			softPenFirstPoint.coordinates[1],
		])
		expectRejected("nonfinite", [
			{
				...softPenFirstPoint.coordinates[0],
				incoming: { x: Number.NaN, y: -20 },
			},
			softPenFirstPoint.coordinates[1],
		])
		expectRejected("missing-master", [softPenFirstPoint.coordinates[0]])
	})

	it("closes without replacing the first point or adding a duplicate", () => {
		const editor = createLoadedEditor("test/close-contour-preserve")
		createOpenPenContour(editor, softPenFirstPoint)
		editor.clearHistory(oGlyphId)
		const beforeNodes = new Map(
			[razorMasterId, blackMasterId].map((masterId) => [
				masterId,
				editor.read.layerNode(masterId, oGlyphId, penPointIds[0]),
			]),
		)

		editor.actions.closeContour({
			glyphId: oGlyphId,
			contourId: penContourId,
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual(penPointIds)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(true)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			expect(editor.read.layerNode(masterId, oGlyphId, penPointIds[0])).toEqual(
				beforeNodes.get(masterId),
			)
		}
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toMatchObject({ at: 1, length: 1 })

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(false)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			expect(editor.read.layerNode(masterId, oGlyphId, penPointIds[0])).toEqual(
				beforeNodes.get(masterId),
			)
		}
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(true)
	})

	it("replaces the first point handles and closes as one history entry", () => {
		const editor = createLoadedEditor("test/close-contour-replace")
		createOpenPenContour(editor)
		editor.clearHistory(oGlyphId)
		const replacement = [
			{
				masterId: razorMasterId,
				incoming: { x: -30, y: -60 },
				outgoing: { x: 15, y: 30 },
			},
			{
				masterId: blackMasterId,
				incoming: { x: -80, y: 0 },
				outgoing: { x: 40, y: 0 },
			},
		] as const

		editor.actions.closeContour({
			glyphId: oGlyphId,
			contourId: penContourId,
			firstPoint: {
				pointId: penPointIds[0],
				mode: "soft",
				coordinates: replacement,
			},
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual(penPointIds)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(true)
		for (const coordinate of replacement) {
			expect(
				editor.read.layerNode(coordinate.masterId, oGlyphId, penPointIds[0]),
			).toMatchObject({
				ok: true,
				value: {
					mode: "soft",
					incoming: coordinate.incoming,
					outgoing: coordinate.outgoing,
				},
			})
		}
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toMatchObject({ at: 1, length: 1 })

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(false)
		expect(
			editor.silo.getState(editor.atoms.point, [oGlyphId, penPointIds[0]]),
		).toEqual({ mode: "hard" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const node = editor.read.layerNode(masterId, oGlyphId, penPointIds[0])
			if (!node.ok) throw new Error("Undone first point did not project.")
			expect(node.value.incoming).toBeUndefined()
			expect(node.value.outgoing).toBeUndefined()
		}
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(true)
		expect(
			editor.silo.getState(editor.atoms.point, [oGlyphId, penPointIds[0]]),
		).toEqual({ mode: "soft" })
	})

	it("rejects invalid closure plans without partial mutation", () => {
		const editor = createLoadedEditor("test/close-contour-invalid-plan")
		createOpenPenContour(editor)
		editor.clearHistory(oGlyphId)
		const before = editor.read.editorSource()
		const validCoordinates = [
			{
				masterId: razorMasterId,
				incoming: { x: -20, y: 0 },
				outgoing: { x: 40, y: 0 },
			},
			{
				masterId: blackMasterId,
				incoming: { x: -30, y: 0 },
				outgoing: { x: 60, y: 0 },
			},
		] as const
		const invalidInputs = [
			{
				glyphId: oGlyphId,
				contourId: penContourId,
				firstPoint: {
					pointId: penPointIds[1],
					mode: "soft" as const,
					coordinates: validCoordinates,
				},
			},
			{
				glyphId: oGlyphId,
				contourId: penContourId,
				firstPoint: {
					pointId: penPointIds[0],
					mode: "soft" as const,
					coordinates: [validCoordinates[0]],
				},
			},
			{
				glyphId: oGlyphId,
				contourId: penContourId,
				firstPoint: {
					pointId: penPointIds[0],
					mode: "soft" as const,
					coordinates: [validCoordinates[0], validCoordinates[0]],
				},
			},
			{
				glyphId: oGlyphId,
				contourId: penContourId,
				firstPoint: {
					pointId: penPointIds[0],
					mode: "soft" as const,
					coordinates: [
						{
							...validCoordinates[0],
							outgoing: { x: 0, y: 40 },
						},
						validCoordinates[1],
					],
				},
			},
			{
				glyphId: oGlyphId,
				contourId: penContourId,
				firstPoint: {
					pointId: penPointIds[0],
					mode: "soft" as const,
					coordinates: [
						{
							...validCoordinates[0],
							incoming: { x: Number.POSITIVE_INFINITY, y: 0 },
						},
						validCoordinates[1],
					],
				},
			},
		] as const

		for (const input of invalidInputs) {
			expect(() => editor.actions.closeContour(input)).toThrow()
			expect(editor.read.editorSource()).toEqual(before)
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
			).toMatchObject({ at: 0, length: 0 })
		}
	})

	it("rejects incomplete closure topology before writing", () => {
		const shortEditor = createLoadedEditor("test/close-contour-short")
		shortEditor.actions.createContour({
			glyphId: oGlyphId,
			contourId: penContourId,
			point: { id: penPointIds[0], mode: "hard" },
			coordinates: hardPenFirstPoint.coordinates,
		})
		shortEditor.clearHistory(oGlyphId)
		expect(() =>
			shortEditor.actions.closeContour({
				glyphId: oGlyphId,
				contourId: penContourId,
			}),
		).toThrow("at least three points")
		expect(
			shortEditor.silo.inspectTimeline(
				shortEditor.glyphHistoryTimelines,
				oGlyphId,
			),
		).toMatchObject({ at: 0, length: 0 })

		const missingLayerEditor = createLoadedEditor(
			"test/close-contour-missing-layer",
		)
		createOpenPenContour(missingLayerEditor)
		missingLayerEditor.silo.setState(
			missingLayerEditor.atoms.pointPosition,
			[blackMasterId, oGlyphId, penPointIds[0]],
			null,
		)
		missingLayerEditor.clearHistory(oGlyphId)
		expect(() =>
			missingLayerEditor.actions.closeContour({
				glyphId: oGlyphId,
				contourId: penContourId,
			}),
		).toThrow("invalid in layer")
		expect(
			missingLayerEditor.silo.getState(missingLayerEditor.atoms.contourClosed, [
				oGlyphId,
				penContourId,
			]),
		).toBe(false)
		expect(
			missingLayerEditor.silo.inspectTimeline(
				missingLayerEditor.glyphHistoryTimelines,
				oGlyphId,
			),
		).toMatchObject({ at: 0, length: 0 })
	})

	it("derives horizontal phantom deltas from layer metrics", () => {
		const source = makeGeometricOEditorFont()
		for (const glyph of source.glyphs) {
			const layer = glyph.layers.find(
				(candidate) => candidate.masterId === blackMasterId,
			)
			if (layer === undefined) throw new Error("Black layer is missing.")
			Object.assign(layer, { advanceWidth: 1_100 })
		}
		const editor = createFontEditorState({ key: "test/phantom" })
		editor.actions.load(source)

		const glyph = editor.read.glyphSource(oGlyphId)
		expect(glyph.ok).toBe(true)
		if (!glyph.ok) return
		expect(glyph.value.variations[0]?.deltas.phantom).toEqual({
			left: 0,
			right: 100,
			top: 0,
			bottom: 0,
		})
	})

	it("reports incomplete layers as projection failures", () => {
		const source = makeGeometricOEditorFont()
		const glyph = source.glyphs.find((candidate) => candidate.id === oGlyphId)
		const layer = glyph?.layers.find(
			(candidate) => candidate.masterId === blackMasterId,
		)
		if (layer === undefined) throw new Error("Black layer is missing.")
		Object.assign(layer, { points: layer.points.slice(1) })
		const editor = createFontEditorState({ key: "test/incomplete" })
		editor.actions.load(source)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage !== "projection-failed") return
		expect(compilation.projectionErrors).toContainEqual(
			expect.objectContaining({ code: "number.missing_or_nonfinite" }),
		)
	})

	it("keeps low-level ingestion failures distinct from projection failures", () => {
		const source = makeGeometricOEditorFont()
		Object.assign(source.names, { family: "" })
		const editor = createFontEditorState({ key: "test/ingestion" })
		editor.actions.load(source)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("ingestion-failed")
		if (compilation.stage !== "ingestion-failed") return
		expect(compilation.ingestionErrors).toContainEqual(
			expect.objectContaining({ code: "name.empty", path: "$.names.family" }),
		)
	})

	it("can atomically replace a loaded document", () => {
		const editor = createLoadedEditor("test/replace")
		const replacement = makeGeometricOEditorFont()
		Object.assign(replacement.names, { family: "Replacement O" })
		const pointId = replacement.glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 625, y: 800 }],
		})
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)

		editor.actions.load(replacement)

		expect(editor.read.editorSource()?.names.family).toBe("Replacement O")
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(0)
		editor.undo(oGlyphId)
		expect(editor.read.editorSource()?.names.family).toBe("Replacement O")
	})

	it("invalidates same-ID derived selectors when replacing geometry", () => {
		const editor = createLoadedEditor("test/replace-same-ids")
		const before = editor.read.glyphSource(oGlyphId)
		expect(before.ok && before.value.variations[0]?.deltas.points[8]?.y).toBe(
			-320,
		)

		const replacement = makeGeometricOEditorFont()
		const glyph = replacement.glyphs.find(
			(candidate) => candidate.id === oGlyphId,
		)
		const layer = glyph?.layers.find(
			(candidate) => candidate.masterId === blackMasterId,
		)
		const point = layer?.points[4]
		if (point === undefined) throw new Error("Replacement point is missing.")
		Object.assign(point, { y: 400 })

		editor.actions.load(replacement)

		const after = editor.read.glyphSource(oGlyphId)
		expect(after.ok && after.value.variations[0]?.deltas.points[8]?.y).toBe(
			-360,
		)
	})

	it("snapshots caller-owned input and freezes cached projections", () => {
		const source = makeGeometricOEditorFont()
		const editor = createFontEditorState({ key: "test/ownership" })
		editor.actions.load(source)
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("compiled")
		if (!compilation.ok) return

		Object.assign(source.names, { family: "Caller mutation" })

		expect(Object.isFrozen(source.names)).toBe(false)
		expect(editor.read.editorSource()?.names.family).toBe("Create Font O Razor")
		expect(editor.read.compilation()).toBe(compilation)
		expect(compilation.source.names.family).toBe("Create Font O Razor")
		expect(Object.isFrozen(compilation.source)).toBe(true)
		expect(Object.isFrozen(compilation.source.glyphs[1]?.contours)).toBe(true)
		expect(() =>
			Object.assign(compilation.source.names, { family: "Cache mutation" }),
		).toThrow()
	})

	it("does not serialize a missing point position", () => {
		const editor = createLoadedEditor("test/partial-coordinate")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")

		editor.silo.setState(
			editor.atoms.pointPosition,
			[blackMasterId, oGlyphId, pointId],
			null,
		)

		expect(
			editor.read
				.editorSource()
				?.glyphs[1]?.layers[1]?.points.some(
					(point) => point.pointId === pointId,
				),
		).toBe(false)
		expect(editor.read.compilation().stage).toBe("projection-failed")
	})

	it("diagnoses topology corruption even through the raw atom surface", () => {
		const editor = createLoadedEditor("test/topology-invariant")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const firstPointId = contour?.points[0]?.id
		if (contour === undefined || firstPointId === undefined) {
			throw new Error("Fixture topology is missing.")
		}
		editor.silo.setState(
			editor.atoms.contourPointIds,
			[oGlyphId, contour.id],
			[
				firstPointId,
				firstPointId,
				...contour.points.slice(2).map(({ id }) => id),
			],
		)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage !== "projection-failed") return
		expect(compilation.projectionErrors).toContainEqual(
			expect.objectContaining({ code: "topology.duplicate_point" }),
		)
		expect(editor.read.editorSource()).toBeNull()
	})

	it("keeps editor-only annotations out of lowering dependencies", () => {
		const editor = createLoadedEditor("test/editor-only")
		const glyphBefore = editor.read.glyphSource(oGlyphId)
		const layerBefore = editor.read.glyphLayer(blackMasterId, oGlyphId)
		editor.silo.setState(editor.atoms.glyphEditor, oGlyphId, {
			note: "Selected for review",
			color: "#ff00ff",
		})

		expect(editor.read.glyphSource(oGlyphId)).toBe(glyphBefore)
		expect(editor.read.glyphLayer(blackMasterId, oGlyphId)).toBe(layerBefore)
		expect(editor.read.editorSource()?.glyphs[1]?.note).toBe(
			"Selected for review",
		)
	})

	it("rejects structurally ambiguous documents without a partial write", () => {
		const editor = createLoadedEditor("test/atomic-load")
		const malformed = makeGeometricOEditorFont()
		Object.assign(malformed, {
			glyphs: malformed.glyphs.map((glyph, index) =>
				index === 1 ? { ...glyph, id: notdefGlyphId } : glyph,
			),
		})

		expect(() => editor.actions.load(malformed)).toThrow(/Glyph IDs/)
		expect(editor.read.editorSource()?.glyphs[1]?.id).toBe(oGlyphId)
	})

	it("transforms mixed nodes and absolute handle endpoints in one history entry", () => {
		const editor = createLoadedEditor("test/transform-controls")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (
			!before.ok ||
			before.value.incoming === undefined ||
			before.value.outgoing === undefined
		)
			throw new Error("Fixture handles are missing.")

		editor.actions.transformControls({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: before.value.x + 30, y: before.value.y - 40 }],
			handles: [
				{
					pointId,
					handle: "incoming",
					x: before.value.x + before.value.incoming.x + 30,
					y: before.value.y + before.value.incoming.y - 40,
				},
				{
					pointId,
					handle: "outgoing",
					x: before.value.x + before.value.outgoing.x + 30,
					y: before.value.y + before.value.outgoing.y - 40,
				},
			],
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok) throw new Error("Transformed node did not project.")
		expect(after.value.x).toBe(before.value.x + 30)
		expect(after.value.y).toBe(before.value.y - 40)
		expect(after.value.incoming?.x).toBeCloseTo(before.value.incoming.x, 10)
		expect(after.value.incoming?.y).toBeCloseTo(before.value.incoming.y, 10)
		expect(after.value.outgoing?.x).toBeCloseTo(before.value.outgoing.x, 10)
		expect(after.value.outgoing?.y).toBeCloseTo(before.value.outgoing.y, 10)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)

		editor.undo(oGlyphId)
		expect(editor.read.layerNode(blackMasterId, oGlyphId, pointId)).toEqual(
			before,
		)
	})

	it("slides one soft node while preserving absolute handles and master isolation", () => {
		const editor = createLoadedEditor("test/slide-soft-node")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const otherBefore = editor.read.layerNode(razorMasterId, oGlyphId, pointId)
		if (
			!before.ok ||
			!otherBefore.ok ||
			before.value.incoming === undefined ||
			before.value.outgoing === undefined
		) {
			throw new Error("Fixture soft node is incomplete.")
		}
		const incoming = {
			x: before.value.x + before.value.incoming.x,
			y: before.value.y + before.value.incoming.y,
		}
		const outgoing = {
			x: before.value.x + before.value.outgoing.x,
			y: before.value.y + before.value.outgoing.y,
		}
		const next = {
			x: incoming.x + (outgoing.x - incoming.x) * 0.3,
			y: incoming.y + (outgoing.y - incoming.y) * 0.3,
		}

		editor.actions.slideSoftNode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			...next,
			handles: [
				{ handle: "incoming", ...incoming },
				{ handle: "outgoing", ...outgoing },
			],
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(after.ok).toBe(true)
		if (!after.ok) return
		expect(after.value).toMatchObject({ ...next, mode: "soft" })
		expect({
			x: after.value.x + (after.value.incoming?.x ?? 0),
			y: after.value.y + (after.value.incoming?.y ?? 0),
		}).toEqual(incoming)
		expect({
			x: after.value.x + (after.value.outgoing?.x ?? 0),
			y: after.value.y + (after.value.outgoing?.y ?? 0),
		}).toEqual(outgoing)
		expect(editor.read.layerNode(razorMasterId, oGlyphId, pointId)).toEqual(
			otherBefore,
		)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)

		editor.undo(oGlyphId)
		expect(editor.read.layerNode(blackMasterId, oGlyphId, pointId)).toEqual(
			before,
		)
		editor.redo(oGlyphId)
		expect(editor.read.layerNode(blackMasterId, oGlyphId, pointId)).toEqual(
			after,
		)
	})

	it("rejects stale soft-node endpoints without geometry or history changes", () => {
		const editor = createLoadedEditor("test/slide-soft-node-stale")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (
			!before.ok ||
			before.value.incoming === undefined ||
			before.value.outgoing === undefined
		) {
			throw new Error("Fixture soft node is incomplete.")
		}
		const historyLength = editor.silo.inspectTimeline(
			editor.glyphHistoryTimelines,
			oGlyphId,
		).length
		expect(() =>
			editor.actions.slideSoftNode({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId,
				x: before.value.x,
				y: before.value.y,
				handles: [
					{
						handle: "incoming",
						x: before.value.x + before.value.incoming.x + 1,
						y: before.value.y + before.value.incoming.y,
					},
					{
						handle: "outgoing",
						x: before.value.x + before.value.outgoing.x,
						y: before.value.y + before.value.outgoing.y,
					},
				],
			}),
		).toThrow(/endpoint changed/)
		expect(editor.read.layerNode(blackMasterId, oGlyphId, pointId)).toEqual(
			before,
		)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(historyLength)
	})

	it("validates both one-sided tangent bounds including a zero handle", () => {
		for (const handle of ["incoming", "outgoing"] as const) {
			const editor = createLoadedEditor(`test/slide-one-sided-${handle}`)
			const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
			const pointId = contour?.points[0]?.id
			const neighborId =
				handle === "incoming"
					? contour?.points[1]?.id
					: contour?.points.at(-1)?.id
			if (pointId === undefined || neighborId === undefined) {
				throw new Error("Fixture tangent nodes are missing.")
			}
			const removed = handle === "incoming" ? "outgoing" : "incoming"
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				editor.actions.moveHandle({
					masterId,
					glyphId: oGlyphId,
					pointId,
					handle: removed,
					vector: null,
				})
			}
			editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
			const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
			const neighbor = editor.read.layerNode(
				blackMasterId,
				oGlyphId,
				neighborId,
			)
			if (!before.ok || !neighbor.ok || before.value[handle] === undefined) {
				throw new Error("One-sided fixture did not project.")
			}
			const vector = before.value[handle]
			if (vector === undefined) throw new Error("Authored handle is missing.")
			const authored = {
				x: before.value.x + vector.x,
				y: before.value.y + vector.y,
			}
			const neighborVector = neighbor.value[handle]
			const reference = {
				x: neighbor.value.x + (neighborVector?.x ?? 0),
				y: neighbor.value.y + (neighborVector?.y ?? 0),
			}
			editor.actions.slideSoftNode({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId,
				...authored,
				handles: [{ handle, ...authored }],
			})
			const atZero = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
			if (!atZero.ok || atZero.value[handle] === undefined) {
				throw new Error("Zero-bound node did not project.")
			}
			expect(atZero.value[handle]).toEqual({ x: 0, y: 0 })
			const midpoint = {
				x: authored.x + (reference.x - authored.x) * 0.5,
				y: authored.y + (reference.y - authored.y) * 0.5,
			}
			editor.actions.slideSoftNode({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId,
				...midpoint,
				handles: [{ handle, ...authored }],
			})
			const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
			if (!after.ok || after.value[handle] === undefined) {
				throw new Error("Bounded one-sided slide did not project.")
			}
			expect(after.value.x + after.value[handle]!.x).toBeCloseTo(authored.x)
			expect(after.value.y + after.value[handle]!.y).toBeCloseTo(authored.y)
			const historyLength = editor.silo.inspectTimeline(
				editor.glyphHistoryTimelines,
				oGlyphId,
			).length
			const tangent = {
				x: reference.x - authored.x,
				y: reference.y - authored.y,
			}
			const tangentLength = Math.hypot(tangent.x, tangent.y)
			expect(() =>
				editor.actions.slideSoftNode({
					masterId: blackMasterId,
					glyphId: oGlyphId,
					pointId,
					x: midpoint.x - tangent.y / tangentLength,
					y: midpoint.y + tangent.x / tangentLength,
					handles: [{ handle, ...authored }],
				}),
			).toThrow(/tangent bounds/)
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
					.length,
			).toBe(historyLength)
		}
	})

	it("prevalidates malformed handle state before move or transform writes", () => {
		const editor = createLoadedEditor("test/handle-preflight")
		const points = makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points
		const pointId = points?.[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		const atomKey = [blackMasterId, oGlyphId, pointId] as const
		const beforePosition = editor.silo.getState(
			editor.atoms.pointPosition,
			atomKey,
		)
		const beforeIncomingX = editor.silo.getState(
			editor.atoms.incomingHandleX,
			atomKey,
		)
		editor.silo.setState(editor.atoms.outgoingHandleY, atomKey, null)
		expect(() =>
			editor.actions.moveHandle({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: { x: 999, y: 999 },
			}),
		).toThrow(/invalid layer geometry/)
		expect(editor.silo.getState(editor.atoms.incomingHandleX, atomKey)).toBe(
			beforeIncomingX,
		)
		expect(() =>
			editor.actions.transformControls({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				points: [{ pointId, x: 321, y: 654 }],
				handles: [],
			}),
		).toThrow(/invalid layer geometry/)
		expect(editor.silo.getState(editor.atoms.pointPosition, atomKey)).toEqual(
			beforePosition,
		)
	})

	it("reuses an explicit ray after an unbounded one-sided handle reaches zero", () => {
		const editor = createLoadedEditor("test/slide-open-zero-ray")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		editor.silo.setState(
			editor.atoms.contourClosed,
			[oGlyphId, contour.id],
			false,
		)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: null,
			})
		}
		editor.silo.setState(
			editor.atoms.point,
			[oGlyphId, pointId],
			Object.freeze({ mode: "soft" }),
		)
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!before.ok || before.value.outgoing === undefined) {
			throw new Error("Open one-sided node did not project.")
		}
		const authored = {
			x: before.value.x + before.value.outgoing.x,
			y: before.value.y + before.value.outgoing.y,
		}
		const direction = {
			x: before.value.x - authored.x,
			y: before.value.y - authored.y,
		}
		editor.actions.slideSoftNode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			...authored,
			handles: [{ handle: "outgoing", ...authored }],
			unboundedDirection: direction,
		})
		const length = Math.hypot(direction.x, direction.y)
		const next = {
			x: authored.x + (direction.x / length) * 10,
			y: authored.y + (direction.y / length) * 10,
		}
		editor.actions.slideSoftNode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			...next,
			handles: [{ handle: "outgoing", ...authored }],
			unboundedDirection: direction,
		})
		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok || after.value.outgoing === undefined) {
			throw new Error("Repeated unbounded slide did not project.")
		}
		expect(after.value.x + after.value.outgoing.x).toBeCloseTo(authored.x)
		expect(after.value.y + after.value.outgoing.y).toBeCloseTo(authored.y)
		expect(() =>
			editor.actions.slideSoftNode({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId,
				x: authored.x - direction.x,
				y: authored.y - direction.y,
				handles: [{ handle: "outgoing", ...authored }],
				unboundedDirection: direction,
			}),
		).toThrow(/original tangent ray/)
	})

	it("uses the raw adjacent control as the one-sided tangent bound", () => {
		const editor = createLoadedEditor("test/slide-adjacent-one-sided")
		const points = makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points
		const pointId = points?.[0]?.id
		const neighborId = points?.[1]?.id
		if (pointId === undefined || neighborId === undefined) {
			throw new Error("Fixture points are missing.")
		}
		for (const targetId of [pointId, neighborId]) {
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				editor.actions.moveHandle({
					masterId,
					glyphId: oGlyphId,
					pointId: targetId,
					handle: "outgoing",
					vector: null,
				})
			}
			editor.actions.setNodeMode({
				glyphId: oGlyphId,
				pointId: targetId,
				mode: "soft",
			})
		}
		const neighborBefore = editor.read.layerNode(
			blackMasterId,
			oGlyphId,
			neighborId,
		)
		if (!neighborBefore.ok) throw new Error("Neighbor did not project.")
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [
				{
					pointId: neighborId,
					x: neighborBefore.value.x + 37,
					y: neighborBefore.value.y + 53,
				},
			],
		})
		const current = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const neighborPosition = editor.silo.getState(editor.atoms.pointPosition, [
			blackMasterId,
			oGlyphId,
			neighborId,
		])
		const rawX = editor.silo.getState(editor.atoms.incomingHandleX, [
			blackMasterId,
			oGlyphId,
			neighborId,
		])
		const rawY = editor.silo.getState(editor.atoms.incomingHandleY, [
			blackMasterId,
			oGlyphId,
			neighborId,
		])
		if (
			!current.ok ||
			current.value.incoming === undefined ||
			neighborPosition === null ||
			rawX === null ||
			rawY === null
		) {
			throw new Error("Adjacent one-sided geometry is incomplete.")
		}
		const authored = {
			x: current.value.x + current.value.incoming.x,
			y: current.value.y + current.value.incoming.y,
		}
		const rawReference = {
			x: neighborPosition.x + rawX,
			y: neighborPosition.y + rawY,
		}
		const midpoint = {
			x: (authored.x + rawReference.x) / 2,
			y: (authored.y + rawReference.y) / 2,
		}
		editor.actions.slideSoftNode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			...midpoint,
			handles: [{ handle: "incoming", ...authored }],
		})
		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(after.ok).toBe(true)
		if (!after.ok || after.value.incoming === undefined) return
		expect(after.value.x + after.value.incoming.x).toBeCloseTo(authored.x)
		expect(after.value.y + after.value.incoming.y).toBeCloseTo(authored.y)
	})

	it("splits a curved segment at one shared parameter across all masters", () => {
		const editor = createLoadedEditor("test/split-segment")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const startPointId = contour?.points[0]?.id
		const endPointId = contour?.points[1]?.id
		if (
			contour === undefined ||
			startPointId === undefined ||
			endPointId === undefined
		) {
			throw new Error("Fixture segment is missing.")
		}
		const insertedId = "point:glyph:O:split-test" as const
		const amount = 0.35
		const before = new Map(
			[razorMasterId, blackMasterId].map((masterId) => {
				const start = editor.read.layerNode(masterId, oGlyphId, startPointId)
				const end = editor.read.layerNode(masterId, oGlyphId, endPointId)
				if (!start.ok || !end.ok)
					throw new Error("Fixture nodes did not project.")
				return [masterId, { start: start.value, end: end.value }] as const
			}),
		)

		editor.actions.splitSegment({
			glyphId: oGlyphId,
			contourId: contour.id,
			segmentIndex: 0,
			pointId: insertedId,
			amount,
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			])?.[1],
		).toBe(insertedId)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const original = before.get(masterId)
			const inserted = editor.read.layerNode(masterId, oGlyphId, insertedId)
			if (original === undefined || !inserted.ok)
				throw new Error("Split node is missing.")
			const cubic = {
				p0: original.start,
				c1: {
					x: original.start.x + (original.start.outgoing?.x ?? 0),
					y: original.start.y + (original.start.outgoing?.y ?? 0),
				},
				c2: {
					x: original.end.x + (original.end.incoming?.x ?? 0),
					y: original.end.y + (original.end.incoming?.y ?? 0),
				},
				p3: original.end,
			}
			const expected = evaluateCubicCurve(cubic, amount)
			expect(inserted.value.x).toBeCloseTo(expected.x, 10)
			expect(inserted.value.y).toBeCloseTo(expected.y, 10)
			expect(inserted.value.incoming).toBeDefined()
			expect(inserted.value.outgoing).toBeDefined()
		}
		expect(editor.read.compilation().stage).toBe("compiled")
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual(contour.points.map(({ id }) => id))
	})

	it("adds exact one-third handles across all masters as one history entry", () => {
		const fixture = makeStraightSegmentFixture()
		const editor = createFontEditorState({ key: "test/add-segment-handles" })
		editor.actions.load(fixture.source)
		const before = new Map(
			[razorMasterId, blackMasterId].map((masterId) => {
				const start = editor.read.layerNode(
					masterId,
					oGlyphId,
					fixture.startPointId,
				)
				const end = editor.read.layerNode(
					masterId,
					oGlyphId,
					fixture.endPointId,
				)
				if (!start.ok || !end.ok) {
					throw new Error("Straight fixture nodes did not project.")
				}
				const startKey = [masterId, oGlyphId, fixture.startPointId] as const
				const endKey = [masterId, oGlyphId, fixture.endPointId] as const
				return [
					masterId,
					{
						start: start.value,
						end: end.value,
						startIncoming: {
							x: editor.silo.getState(editor.atoms.incomingHandleX, startKey),
							y: editor.silo.getState(editor.atoms.incomingHandleY, startKey),
						},
						endOutgoing: {
							x: editor.silo.getState(editor.atoms.outgoingHandleX, endKey),
							y: editor.silo.getState(editor.atoms.outgoingHandleY, endKey),
						},
					},
				] as const
			}),
		)

		expect(
			editor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: fixture.contourId,
				segmentIndex: fixture.segmentIndex,
			}),
		).toBe(true)

		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const original = before.get(masterId)
			const start = editor.read.layerNode(
				masterId,
				oGlyphId,
				fixture.startPointId,
			)
			const end = editor.read.layerNode(masterId, oGlyphId, fixture.endPointId)
			if (original === undefined || !start.ok || !end.ok) {
				throw new Error("Converted segment nodes did not project.")
			}
			const expected = straightSegmentHandles(original.start, original.end)
			if (expected === null) throw new Error("Fixture segment is degenerate.")
			expect(start.value.outgoing).toEqual(expected.startOutgoing)
			expect(end.value.incoming).toEqual(expected.endIncoming)
			expect(start.value.mode).toBe("hard")
			expect(end.value.mode).toBe("hard")
			const startKey = [masterId, oGlyphId, fixture.startPointId] as const
			const endKey = [masterId, oGlyphId, fixture.endPointId] as const
			expect({
				x: editor.silo.getState(editor.atoms.incomingHandleX, startKey),
				y: editor.silo.getState(editor.atoms.incomingHandleY, startKey),
			}).toEqual(original.startIncoming)
			expect({
				x: editor.silo.getState(editor.atoms.outgoingHandleX, endKey),
				y: editor.silo.getState(editor.atoms.outgoingHandleY, endKey),
			}).toEqual(original.endOutgoing)
		}
		const plan = editor.silo.getState(editor.selectors.curveSegmentPlan, [
			oGlyphId,
			fixture.contourId,
			fixture.segmentIndex,
		])
		expect(plan.ok && plan.value.curved).toBe(true)
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toMatchObject({ at: 1, length: 1 })

		editor.undo(oGlyphId)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const start = editor.read.layerNode(
				masterId,
				oGlyphId,
				fixture.startPointId,
			)
			const end = editor.read.layerNode(masterId, oGlyphId, fixture.endPointId)
			if (!start.ok || !end.ok) throw new Error("Undo nodes did not project.")
			expect(start.value.outgoing).toBeUndefined()
			expect(end.value.incoming).toBeUndefined()
			expect(start.value.mode).toBe("soft")
			expect(end.value.mode).toBe("soft")
		}
		editor.redo(oGlyphId)
		expect(
			editor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: fixture.contourId,
				segmentIndex: fixture.segmentIndex,
			}),
		).toBe(false)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toMatchObject({ at: 1, length: 1 })
	})

	it("keeps ineligible cross-master and degenerate segments unchanged", () => {
		const curvedFixture = makeStraightSegmentFixture()
		const curvedEditor = createFontEditorState({
			key: "test/add-handles-curved",
		})
		curvedEditor.actions.load(curvedFixture.source)
		curvedEditor.actions.moveHandle({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			pointId: curvedFixture.startPointId,
			handle: "outgoing",
			vector: { x: 10, y: -20 },
		})
		curvedEditor.clearHistory(oGlyphId)
		expect(
			curvedEditor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: curvedFixture.contourId,
				segmentIndex: curvedFixture.segmentIndex,
			}),
		).toBe(false)
		const blackStraight = curvedEditor.read.layerNode(
			blackMasterId,
			oGlyphId,
			curvedFixture.startPointId,
		)
		if (!blackStraight.ok) throw new Error("Black fixture did not project.")
		expect(blackStraight.value.outgoing).toBeUndefined()
		expect(
			curvedEditor.silo.inspectTimeline(
				curvedEditor.glyphHistoryTimelines,
				oGlyphId,
			),
		).toMatchObject({ at: 0, length: 0 })

		const zeroFixture = makeStraightSegmentFixture()
		const zeroEditor = createFontEditorState({ key: "test/add-handles-zero" })
		zeroEditor.actions.load(zeroFixture.source)
		const blackStart = zeroEditor.read.layerNode(
			blackMasterId,
			oGlyphId,
			zeroFixture.startPointId,
		)
		if (!blackStart.ok) throw new Error("Zero fixture start did not project.")
		zeroEditor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [
				{
					pointId: zeroFixture.endPointId,
					x: blackStart.value.x,
					y: blackStart.value.y,
				},
			],
		})
		zeroEditor.clearHistory(oGlyphId)
		expect(
			zeroEditor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: zeroFixture.contourId,
				segmentIndex: zeroFixture.segmentIndex,
			}),
		).toBe(false)
		const razorStraight = zeroEditor.read.layerNode(
			razorMasterId,
			oGlyphId,
			zeroFixture.startPointId,
		)
		if (!razorStraight.ok) throw new Error("Razor fixture did not project.")
		expect(razorStraight.value.outgoing).toBeUndefined()
		expect(
			zeroEditor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: zeroFixture.contourId,
				segmentIndex: 99,
			}),
		).toBe(false)
		expect(
			zeroEditor.silo.inspectTimeline(
				zeroEditor.glyphHistoryTimelines,
				oGlyphId,
			),
		).toMatchObject({ at: 0, length: 0 })
	})

	it("keeps compatible soft endpoints soft in every master", () => {
		const fixture = makeStraightSegmentFixture()
		const glyph = fixture.source.glyphs.find(
			(candidate) => candidate.id === oGlyphId,
		)
		if (glyph === undefined) throw new Error("Fixture glyph is missing.")
		for (const layer of glyph.layers) {
			const start = layer.points.find(
				(point) => point.pointId === fixture.startPointId,
			) as
				| {
						x: number
						y: number
						incoming?: { readonly x: number; readonly y: number }
				  }
				| undefined
			const end = layer.points.find(
				(point) => point.pointId === fixture.endPointId,
			) as
				| {
						x: number
						y: number
						outgoing?: { readonly x: number; readonly y: number }
				  }
				| undefined
			if (start === undefined || end === undefined) {
				throw new Error("Fixture layer segment is missing.")
			}
			const handles = straightSegmentHandles(start, end)
			if (handles === null) throw new Error("Fixture segment is degenerate.")
			start.incoming = {
				x: -handles.startOutgoing.x,
				y: -handles.startOutgoing.y,
			}
			end.outgoing = {
				x: -handles.endIncoming.x,
				y: -handles.endIncoming.y,
			}
		}
		const editor = createFontEditorState({ key: "test/add-handles-soft" })
		editor.actions.load(fixture.source)
		expect(
			editor.actions.addSegmentHandles({
				glyphId: oGlyphId,
				contourId: fixture.contourId,
				segmentIndex: fixture.segmentIndex,
			}),
		).toBe(true)
		for (const pointId of [fixture.startPointId, fixture.endPointId]) {
			expect(
				editor.silo.getState(editor.atoms.point, [oGlyphId, pointId]),
			).toEqual({ mode: "soft" })
		}
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("supports open and closing straight segments", () => {
		for (const [name, fixture] of [
			["open", makeStraightSegmentFixture({ closed: false, segmentIndex: 0 })],
			[
				"closing",
				makeStraightSegmentFixture({ closed: true, segmentIndex: 3 }),
			],
		] as const) {
			const editor = createFontEditorState({ key: `test/add-handles-${name}` })
			editor.actions.load(fixture.source)
			expect(
				editor.actions.addSegmentHandles({
					glyphId: oGlyphId,
					contourId: fixture.contourId,
					segmentIndex: fixture.segmentIndex,
				}),
			).toBe(true)
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				const start = editor.read.layerNode(
					masterId,
					oGlyphId,
					fixture.startPointId,
				)
				const end = editor.read.layerNode(
					masterId,
					oGlyphId,
					fixture.endPointId,
				)
				expect(start).toMatchObject({
					ok: true,
					value: { outgoing: expect.any(Object) },
				})
				expect(end).toMatchObject({
					ok: true,
					value: { incoming: expect.any(Object) },
				})
			}
		}
	})

	it("reverses a closed contour while preserving its first node and geometry handles", () => {
		const editor = createLoadedEditor("test/reverse-contour")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		if (contour === undefined) throw new Error("Fixture contour is missing.")
		const order = contour.points.map(({ id }) => id)
		const handles = new Map(
			[razorMasterId, blackMasterId].flatMap((masterId) =>
				order.map((pointId) => {
					const node = editor.read.layerNode(masterId, oGlyphId, pointId)
					if (!node.ok) throw new Error("Fixture node did not project.")
					return [`${masterId}/${pointId}`, node.value] as const
				}),
			),
		)

		editor.actions.reverseContour({ glyphId: oGlyphId, contourId: contour.id })
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual([order[0], ...order.slice(1).reverse()])
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			for (const pointId of order) {
				const before = handles.get(`${masterId}/${pointId}`)
				const after = editor.read.layerNode(masterId, oGlyphId, pointId)
				if (before === undefined || !after.ok)
					throw new Error("Reversed node is missing.")
				expect(after.value.incoming).toEqual(before.outgoing)
				expect(after.value.outgoing).toEqual(before.incoming)
			}
		}
		expect(editor.read.compilation().stage).toBe("compiled")
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual(order)
	})

	it("reverses an open contour from its last node and swaps endpoint handles", () => {
		const editor = createLoadedEditor("test/reverse-open-contour")
		createOpenPenContour(editor, softPenFirstPoint)
		const before = new Map(
			[razorMasterId, blackMasterId].flatMap((masterId) =>
				penPointIds.map((pointId) => {
					const node = editor.read.layerNode(masterId, oGlyphId, pointId)
					if (!node.ok) throw new Error("Open-contour node did not project.")
					return [`${masterId}/${pointId}`, node.value] as const
				}),
			),
		)

		editor.actions.reverseContour({
			glyphId: oGlyphId,
			contourId: penContourId,
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual([...penPointIds].reverse())
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			for (const pointId of penPointIds) {
				const oldNode = before.get(`${masterId}/${pointId}`)
				const node = editor.read.layerNode(masterId, oGlyphId, pointId)
				if (oldNode === undefined || !node.ok) {
					throw new Error("Reversed open-contour node is missing.")
				}
				expect(node.value.incoming).toEqual(oldNode.outgoing)
				expect(node.value.outgoing).toEqual(oldNode.incoming)
			}
		}
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual(penPointIds)
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual([...penPointIds].reverse())
	})

	it("reverses one- and two-node open contours without losing endpoints", () => {
		const editor = createLoadedEditor("test/reverse-short-open-contours")
		editor.actions.createContour({
			glyphId: oGlyphId,
			contourId: penContourId,
			point: { id: penPointIds[0], mode: "hard" },
			coordinates: hardPenFirstPoint.coordinates,
		})
		editor.actions.reverseContour({
			glyphId: oGlyphId,
			contourId: penContourId,
		})
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual([penPointIds[0]])

		editor.actions.insertPoint({
			glyphId: oGlyphId,
			contourId: penContourId,
			point: { id: penPointIds[1], mode: "hard" },
			coordinates: [
				{ masterId: razorMasterId, x: 400, y: 300 },
				{ masterId: blackMasterId, x: 430, y: 280 },
			],
		})
		editor.actions.reverseContour({
			glyphId: oGlyphId,
			contourId: penContourId,
		})
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual([penPointIds[1], penPointIds[0]])
	})

	it("inverts a contour and reverses every master in one history entry", () => {
		const editor = createLoadedEditor("test/invert-contour")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[1]
		if (contour === undefined) throw new Error("Fixture contour is missing.")
		const order = contour.points.map(({ id }) => id)
		const before = new Map(
			[razorMasterId, blackMasterId].flatMap((masterId) =>
				order.map((pointId) => {
					const node = editor.read.layerNode(masterId, oGlyphId, pointId)
					if (!node.ok) throw new Error("Fixture node did not project.")
					return [`${masterId}/${pointId}`, node.value] as const
				}),
			),
		)
		const activeControls = order.flatMap((pointId) => {
			const node = before.get(`${blackMasterId}/${pointId}`)
			if (node === undefined) throw new Error("Active fixture node is missing.")
			return [
				{ x: node.x, y: node.y },
				...(node.incoming === undefined
					? []
					: [
							{
								x: node.x + node.incoming.x,
								y: node.y + node.incoming.y,
							},
						]),
				...(node.outgoing === undefined
					? []
					: [
							{
								x: node.x + node.outgoing.x,
								y: node.y + node.outgoing.y,
							},
						]),
			]
		})
		const centerX =
			(Math.min(...activeControls.map(({ x }) => x)) +
				Math.max(...activeControls.map(({ x }) => x))) /
			2
		const centerY =
			(Math.min(...activeControls.map(({ y }) => y)) +
				Math.max(...activeControls.map(({ y }) => y))) /
			2
		const historyLength = editor.silo.inspectTimeline(
			editor.glyphHistoryTimelines,
			oGlyphId,
		).length

		editor.actions.invertContour({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			axis: "horizontal",
			centerX,
			centerY,
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual([order[0], ...order.slice(1).reverse()])
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			for (const pointId of order) {
				const oldNode = before.get(`${masterId}/${pointId}`)
				const node = editor.read.layerNode(masterId, oGlyphId, pointId)
				if (oldNode === undefined || !node.ok) {
					throw new Error("Inverted node is missing.")
				}
				if (masterId === blackMasterId) {
					expect(node.value.x).toBeCloseTo(2 * centerX - oldNode.x, 10)
					expect(node.value.y).toBe(oldNode.y)
					expect(node.value.incoming).toEqual(
						oldNode.outgoing === undefined
							? undefined
							: { x: -oldNode.outgoing.x, y: oldNode.outgoing.y },
					)
					expect(node.value.outgoing).toEqual(
						oldNode.incoming === undefined
							? undefined
							: { x: -oldNode.incoming.x, y: oldNode.incoming.y },
					)
				} else {
					expect({ x: node.value.x, y: node.value.y }).toEqual({
						x: oldNode.x,
						y: oldNode.y,
					})
					expect(node.value.incoming).toEqual(oldNode.outgoing)
					expect(node.value.outgoing).toEqual(oldNode.incoming)
				}
			}
		}
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(historyLength + 1)
		expect(editor.read.compilation().stage).toBe("compiled")
		editor.undo(oGlyphId)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			for (const pointId of order) {
				const node = editor.read.layerNode(masterId, oGlyphId, pointId)
				expect(node.ok).toBe(true)
				if (node.ok) {
					expect(node.value).toEqual(before.get(`${masterId}/${pointId}`))
				}
			}
		}
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual([order[0], ...order.slice(1).reverse()])
	})

	it("inverts an open contour and makes its last node first", () => {
		const editor = createLoadedEditor("test/invert-open-contour")
		createOpenPenContour(editor, softPenFirstPoint)
		const before = new Map(
			[razorMasterId, blackMasterId].flatMap((masterId) =>
				penPointIds.map((pointId) => {
					const node = editor.read.layerNode(masterId, oGlyphId, pointId)
					if (!node.ok) throw new Error("Open-contour node did not project.")
					return [`${masterId}/${pointId}`, node.value] as const
				}),
			),
		)
		const controls = penPointIds.flatMap((pointId) => {
			const node = before.get(`${razorMasterId}/${pointId}`)
			if (node === undefined) throw new Error("Active contour node is missing.")
			return [
				{ x: node.x, y: node.y },
				...(node.incoming === undefined
					? []
					: [
							{
								x: node.x + node.incoming.x,
								y: node.y + node.incoming.y,
							},
						]),
				...(node.outgoing === undefined
					? []
					: [
							{
								x: node.x + node.outgoing.x,
								y: node.y + node.outgoing.y,
							},
						]),
			]
		})
		const centerY =
			(Math.min(...controls.map(({ y }) => y)) +
				Math.max(...controls.map(({ y }) => y))) /
			2
		const centerX =
			(Math.min(...controls.map(({ x }) => x)) +
				Math.max(...controls.map(({ x }) => x))) /
			2
		editor.actions.invertContour({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			contourId: penContourId,
			axis: "vertical",
			centerX,
			centerY,
		})
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				penContourId,
			]),
		).toEqual([...penPointIds].reverse())
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			for (const pointId of penPointIds) {
				const oldNode = before.get(`${masterId}/${pointId}`)
				const node = editor.read.layerNode(masterId, oGlyphId, pointId)
				if (oldNode === undefined || !node.ok) {
					throw new Error("Inverted open-contour node is missing.")
				}
				if (masterId === razorMasterId) {
					expect(node.value.x).toBe(oldNode.x)
					expect(node.value.y).toBeCloseTo(2 * centerY - oldNode.y, 10)
					expect(node.value.incoming).toEqual(
						oldNode.outgoing === undefined
							? undefined
							: { x: oldNode.outgoing.x, y: -oldNode.outgoing.y },
					)
					expect(node.value.outgoing).toEqual(
						oldNode.incoming === undefined
							? undefined
							: { x: oldNode.incoming.x, y: -oldNode.incoming.y },
					)
				} else {
					expect(node.value).toEqual({
						...oldNode,
						incoming: oldNode.outgoing,
						outgoing: oldNode.incoming,
					})
				}
			}
		}
	})

	it("rotates a closed contour to make a selected node first", () => {
		const editor = createLoadedEditor("test/make-node-first")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[2]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		const order = contour.points.map(({ id }) => id)

		editor.actions.makeNodeFirst({
			glyphId: oGlyphId,
			contourId: contour.id,
			pointId,
		})
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual([...order.slice(2), ...order.slice(0, 2)])
		expect(editor.read.compilation().stage).toBe("compiled")
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual(order)
	})

	it("cuts closed cubic and open straight segments atomically across masters", () => {
		const closedEditor = createLoadedEditor("test/cut-closed-cubic")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		if (contour === undefined) throw new Error("Fixture contour is missing.")
		const originalOrder = contour.points.map(({ id }) => id)
		const startPointId = originalOrder[0]
		const endPointId = originalOrder[1]
		if (startPointId === undefined || endPointId === undefined) {
			throw new Error("Fixture segment endpoints are missing.")
		}
		const originals = new Map(
			[razorMasterId, blackMasterId].map((masterId) => {
				const start = closedEditor.read.layerNode(
					masterId,
					oGlyphId,
					startPointId,
				)
				const end = closedEditor.read.layerNode(masterId, oGlyphId, endPointId)
				if (!start.ok || !end.ok) throw new Error("Fixture segment is invalid.")
				return [masterId, { start: start.value, end: end.value }] as const
			}),
		)
		const leftPointId = "point:cut:closed:left" as const
		const rightPointId = "point:cut:closed:right" as const
		closedEditor.actions.cutSegment({
			glyphId: oGlyphId,
			contourId: contour.id,
			segmentIndex: 0,
			leftPointId,
			rightPointId,
			amount: 0.4,
		})
		expect(
			closedEditor.silo.getState(closedEditor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual([
			rightPointId,
			...originalOrder.slice(1),
			originalOrder[0],
			leftPointId,
		])
		expect(
			closedEditor.silo.getState(closedEditor.atoms.contourClosed, [
				oGlyphId,
				contour.id,
			]),
		).toBe(false)
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const original = originals.get(masterId)
			const start = closedEditor.read.layerNode(
				masterId,
				oGlyphId,
				startPointId,
			)
			const end = closedEditor.read.layerNode(masterId, oGlyphId, endPointId)
			const left = closedEditor.read.layerNode(masterId, oGlyphId, leftPointId)
			const right = closedEditor.read.layerNode(
				masterId,
				oGlyphId,
				rightPointId,
			)
			if (
				original === undefined ||
				!start.ok ||
				!end.ok ||
				!left.ok ||
				!right.ok
			)
				throw new Error("Cut endpoints are missing.")
			expect(left.value.x).toBeCloseTo(right.value.x, 10)
			expect(left.value.y).toBeCloseTo(right.value.y, 10)
			expect(left.value.incoming).toBeDefined()
			expect(left.value.outgoing).toBeUndefined()
			expect(right.value.incoming).toBeUndefined()
			expect(right.value.outgoing).toBeDefined()
			const cubic = (from: typeof start.value, to: typeof end.value) => ({
				p0: from,
				c1: {
					x: from.x + (from.outgoing?.x ?? 0),
					y: from.y + (from.outgoing?.y ?? 0),
				},
				c2: {
					x: to.x + (to.incoming?.x ?? 0),
					y: to.y + (to.incoming?.y ?? 0),
				},
				p3: to,
			})
			for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
				const originalLeft = evaluateCubicCurve(
					cubic(original.start, original.end),
					amount * 0.4,
				)
				const actualLeft = evaluateCubicCurve(
					cubic(start.value, left.value),
					amount,
				)
				expect(actualLeft.x).toBeCloseTo(originalLeft.x, 9)
				expect(actualLeft.y).toBeCloseTo(originalLeft.y, 9)
				const originalRight = evaluateCubicCurve(
					cubic(original.start, original.end),
					0.4 + amount * 0.6,
				)
				const actualRight = evaluateCubicCurve(
					cubic(right.value, end.value),
					amount,
				)
				expect(actualRight.x).toBeCloseTo(originalRight.x, 9)
				expect(actualRight.y).toBeCloseTo(originalRight.y, 9)
			}
		}
		expect(
			closedEditor.silo.inspectTimeline(
				closedEditor.glyphHistoryTimelines,
				oGlyphId,
			).length,
		).toBe(1)
		closedEditor.undo(oGlyphId)
		expect(
			closedEditor.silo.getState(closedEditor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toEqual(originalOrder)
		closedEditor.redo(oGlyphId)
		expect(
			closedEditor.silo.getState(closedEditor.atoms.contourClosed, [
				oGlyphId,
				contour.id,
			]),
		).toBe(false)

		const openFixture = makeStraightSegmentFixture({ closed: false })
		const openEditor = createFontEditorState({ key: "test/cut-open-straight" })
		openEditor.actions.load(openFixture.source)
		const rightContourId = "contour:cut:open:right" as const
		openEditor.actions.cutSegment({
			glyphId: oGlyphId,
			contourId: openFixture.contourId,
			segmentIndex: openFixture.segmentIndex,
			leftPointId: "point:cut:open:left",
			rightPointId: "point:cut:open:right",
			rightContourId,
			amount: 0.5,
		})
		expect(
			openEditor.silo.getState(openEditor.atoms.glyphContourIds, oGlyphId),
		).toContain(rightContourId)
		expect(
			openEditor.silo.getState(openEditor.atoms.contourPointIds, [
				oGlyphId,
				rightContourId,
			])?.[0],
		).toBe("point:cut:open:right")
	})

	it("joins every dangling-end orientation only through the explicit transaction", () => {
		const cases = [
			[
				"point:join:a:0",
				"point:join:b:0",
				["point:join:a:1", "point:join:b:0", "point:join:b:1"],
			],
			[
				"point:join:a:0",
				"point:join:b:1",
				["point:join:a:1", "point:join:b:1", "point:join:b:0"],
			],
			[
				"point:join:a:1",
				"point:join:b:0",
				["point:join:a:0", "point:join:b:0", "point:join:b:1"],
			],
			[
				"point:join:a:1",
				"point:join:b:1",
				["point:join:a:0", "point:join:b:1", "point:join:b:0"],
			],
		] as const
		for (const [
			caseIndex,
			[draggedPointId, targetPointId, expected],
		] of cases.entries()) {
			const editor = createLoadedEditor(`test/join-open-${caseIndex}`)
			editor.actions.pasteContours({
				glyphId: oGlyphId,
				contours: [
					{
						id: "contour:join:a",
						closed: false,
						points: [
							{ id: "point:join:a:0", mode: "hard" },
							{ id: "point:join:a:1", mode: "hard" },
						],
					},
					{
						id: "contour:join:b",
						closed: false,
						points: [
							{ id: "point:join:b:0", mode: "hard" },
							{ id: "point:join:b:1", mode: "hard" },
						],
					},
				],
				layers: [razorMasterId, blackMasterId].map((masterId, masterIndex) => ({
					masterId,
					points: [
						{
							pointId: "point:join:a:0" as const,
							x: 0,
							y: masterIndex * 10,
							outgoing: { x: 30, y: 0 },
						},
						{
							pointId: "point:join:a:1" as const,
							x: 100,
							y: masterIndex * 10,
							incoming: { x: -20, y: 0 },
							outgoing: { x: 12, y: 12 },
						},
						{
							pointId: "point:join:b:0" as const,
							x: 110,
							y: masterIndex * 10,
							incoming: { x: -12, y: 12 },
							outgoing: { x: 30, y: 0 },
						},
						{
							pointId: "point:join:b:1" as const,
							x: 210,
							y: masterIndex * 10,
							incoming: { x: -30, y: 0 },
						},
					],
				})),
			})
			editor.clearHistory(oGlyphId)
			const before = editor.read.editorGlyphSource(oGlyphId)
			const expectedLayerGeometry = new Map(
				[razorMasterId, blackMasterId].map((masterId) => {
					const dragged = editor.read.layerNode(
						masterId,
						oGlyphId,
						draggedPointId,
					)
					const target = editor.read.layerNode(
						masterId,
						oGlyphId,
						targetPointId,
					)
					if (!dragged.ok || !target.ok)
						throw new Error("Join fixture node is missing.")
					const connectedSource =
						draggedPointId === "point:join:a:0"
							? dragged.value.outgoing
							: dragged.value.incoming
					const connectedTarget =
						targetPointId === "point:join:b:0"
							? target.value.outgoing
							: target.value.incoming
					if (connectedSource === undefined || connectedTarget === undefined)
						throw new Error("Join fixture connected handle is missing.")
					return [
						masterId,
						{
							target: { x: target.value.x, y: target.value.y },
							sourceControl: {
								x: dragged.value.x + connectedSource.x,
								y: dragged.value.y + connectedSource.y,
							},
							targetControl: {
								x: target.value.x + connectedTarget.x,
								y: target.value.y + connectedTarget.y,
							},
						},
					] as const
				}),
			)
			expect(before?.contours).toContainEqual(
				expect.objectContaining({ id: "contour:join:a" }),
			)
			if (caseIndex === 0) {
				editor.actions.movePoints({
					masterId: razorMasterId,
					glyphId: oGlyphId,
					points: [{ pointId: draggedPointId, x: 110, y: 0 }],
				})
				expect(
					editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
				).toEqual(expect.arrayContaining(["contour:join:a", "contour:join:b"]))
				editor.undo(oGlyphId)
				editor.redo(oGlyphId)
				expect(
					editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
				).toEqual(expect.arrayContaining(["contour:join:a", "contour:join:b"]))
				editor.undo(oGlyphId)
				editor.clearHistory(oGlyphId)
			}
			editor.actions.joinOpenContours({
				glyphId: oGlyphId,
				draggedContourId: "contour:join:a",
				draggedPointId,
				targetContourId: "contour:join:b",
				targetPointId,
			})
			expect(
				editor.silo.getState(editor.atoms.contourPointIds, [
					oGlyphId,
					"contour:join:b",
				]),
			).toEqual(expected)
			expect(
				editor.read.layerNode(razorMasterId, oGlyphId, draggedPointId).ok,
			).toBe(false)
			for (const [masterId, expectedGeometry] of expectedLayerGeometry) {
				const survivor = editor.read.layerNode(
					masterId,
					oGlyphId,
					targetPointId,
				)
				if (!survivor.ok) throw new Error("Joined survivor is missing.")
				expect({ x: survivor.value.x, y: survivor.value.y }).toEqual(
					expectedGeometry.target,
				)
				expect(survivor.value.incoming).toBeDefined()
				expect(survivor.value.outgoing).toBeDefined()
				expect(
					survivor.value.x + (survivor.value.incoming?.x ?? 0),
				).toBeCloseTo(expectedGeometry.sourceControl.x, 9)
				expect(
					survivor.value.y + (survivor.value.incoming?.y ?? 0),
				).toBeCloseTo(expectedGeometry.sourceControl.y, 9)
				expect(
					survivor.value.x + (survivor.value.outgoing?.x ?? 0),
				).toBeCloseTo(expectedGeometry.targetControl.x, 9)
				expect(
					survivor.value.y + (survivor.value.outgoing?.y ?? 0),
				).toBeCloseTo(expectedGeometry.targetControl.y, 9)
			}
			expect(
				editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
					.length,
			).toBe(1)
			editor.undo(oGlyphId)
			expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(before)
		}
	})

	it("re-fuses opposite endpoints of one open contour across every master", () => {
		const editor = createLoadedEditor("test/rejoin-open-contour")
		editor.actions.pasteContours({
			glyphId: oGlyphId,
			contours: [
				{
					id: "contour:rejoin",
					closed: false,
					points: [
						{ id: "point:rejoin:first", mode: "hard" },
						{ id: "point:rejoin:middle", mode: "hard" },
						{ id: "point:rejoin:last", mode: "hard" },
					],
				},
			],
			layers: [
				{ masterId: razorMasterId, lastX: 100, incomingX: -20 },
				{ masterId: blackMasterId, lastX: 120, incomingX: -30 },
			].map(({ masterId, lastX, incomingX }) => ({
				masterId,
				points: [
					{
						pointId: "point:rejoin:first",
						x: 0,
						y: 0,
						outgoing: { x: 20, y: 0 },
					},
					{ pointId: "point:rejoin:middle", x: 50, y: 50 },
					{
						pointId: "point:rejoin:last",
						x: lastX,
						y: 0,
						incoming: { x: incomingX, y: 0 },
					},
				],
			})),
		})
		editor.clearHistory(oGlyphId)
		const before = editor.read.editorGlyphSource(oGlyphId)

		editor.actions.joinOpenContours({
			glyphId: oGlyphId,
			draggedContourId: "contour:rejoin",
			draggedPointId: "point:rejoin:last",
			targetContourId: "contour:rejoin",
			targetPointId: "point:rejoin:first",
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				"contour:rejoin",
			]),
		).toEqual(["point:rejoin:first", "point:rejoin:middle"])
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				"contour:rejoin",
			]),
		).toBe(true)
		for (const [masterId, incomingX] of [
			[razorMasterId, 80],
			[blackMasterId, 90],
		] as const) {
			const node = editor.read.layerNode(
				masterId,
				oGlyphId,
				"point:rejoin:first",
			)
			if (!node.ok) throw new Error("Rejoined node is missing.")
			expect(node.value.incoming).toEqual({ x: incomingX, y: 0 })
			expect(node.value.outgoing).toEqual({ x: 20, y: 0 })
		}
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)
		editor.undo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(before)
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [
				oGlyphId,
				"contour:rejoin",
			]),
		).toBe(true)
		editor.undo(oGlyphId)
		editor.clearHistory(oGlyphId)
		editor.actions.joinOpenContours({
			glyphId: oGlyphId,
			draggedContourId: "contour:rejoin",
			draggedPointId: "point:rejoin:first",
			targetContourId: "contour:rejoin",
			targetPointId: "point:rejoin:last",
		})
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				"contour:rejoin",
			]),
		).toEqual(["point:rejoin:middle", "point:rejoin:last"])
		const reverseSurvivor = editor.read.layerNode(
			razorMasterId,
			oGlyphId,
			"point:rejoin:last",
		)
		if (!reverseSurvivor.ok) throw new Error("Reverse survivor is missing.")
		expect(reverseSurvivor.value.incoming).toEqual({ x: -20, y: 0 })
		expect(reverseSurvivor.value.outgoing).toEqual({ x: -80, y: 0 })
	})

	it("atomically translates a selected group and joins its moved endpoint", () => {
		const editor = createLoadedEditor("test/group-join")
		editor.actions.pasteContours({
			glyphId: oGlyphId,
			contours: [
				{
					id: "contour:group:a",
					closed: false,
					points: [
						{ id: "point:group:a0", mode: "hard" },
						{ id: "point:group:a1", mode: "hard" },
					],
				},
				{
					id: "contour:group:b",
					closed: false,
					points: [
						{ id: "point:group:b0", mode: "hard" },
						{ id: "point:group:b1", mode: "hard" },
					],
				},
			],
			layers: [razorMasterId, blackMasterId].map((masterId) => ({
				masterId,
				points: [
					{ pointId: "point:group:a0", x: 0, y: 0 },
					{ pointId: "point:group:a1", x: 100, y: 0 },
					{ pointId: "point:group:b0", x: 200, y: 0 },
					{ pointId: "point:group:b1", x: 300, y: 0 },
				],
			})),
		})
		editor.clearHistory(oGlyphId)
		const before = editor.read.editorGlyphSource(oGlyphId)

		editor.actions.joinOpenContours({
			glyphId: oGlyphId,
			draggedContourId: "contour:group:a",
			draggedPointId: "point:group:a1",
			targetContourId: "contour:group:b",
			targetPointId: "point:group:b0",
			transform: {
				masterId: razorMasterId,
				glyphId: oGlyphId,
				points: [
					{ pointId: "point:group:a0", x: 100, y: 0 },
					{ pointId: "point:group:a1", x: 200, y: 0 },
				],
				handles: [],
			},
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				"contour:group:b",
			]),
		).toEqual(["point:group:a0", "point:group:b0", "point:group:b1"])
		expect(
			editor.read.layerNode(razorMasterId, oGlyphId, "point:group:a0"),
		).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({ x: 100 }),
			}),
		)
		expect(
			editor.read.layerNode(blackMasterId, oGlyphId, "point:group:a0"),
		).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({ x: 0 }),
			}),
		)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)
		editor.undo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(before)
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
		).toEqual(expect.arrayContaining(["contour:group:b"]))
		editor.undo(oGlyphId)
		editor.clearHistory(oGlyphId)
		expect(() =>
			editor.actions.joinOpenContours({
				glyphId: oGlyphId,
				draggedContourId: "contour:group:a",
				draggedPointId: "point:group:a1",
				targetContourId: "contour:group:b",
				targetPointId: "point:group:a0",
				transform: {
					masterId: razorMasterId,
					glyphId: oGlyphId,
					points: [{ pointId: "point:group:a0", x: 999, y: 0 }],
					handles: [],
				},
			}),
		).toThrow()
		expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(before)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(0)
	})

	it("preserves a valid soft join and hardens an incompatible one", () => {
		for (const [caseIndex, sourceIncomingY, expectedMode] of [
			[0, 0, "soft"],
			[1, 10, "hard"],
		] as const) {
			const editor = createLoadedEditor(`test/join-soft-mode-${caseIndex}`)
			editor.actions.pasteContours({
				glyphId: oGlyphId,
				contours: [
					{
						id: "contour:join:soft:source",
						closed: false,
						points: [
							{ id: "point:join:soft:source:0", mode: "hard" },
							{ id: "point:join:soft:source:1", mode: "hard" },
						],
					},
					{
						id: "contour:join:soft:target",
						closed: false,
						points: [
							{ id: "point:join:soft:target:0", mode: "soft" },
							{ id: "point:join:soft:target:1", mode: "hard" },
						],
					},
				],
				layers: [razorMasterId, blackMasterId].map((masterId, index) => ({
					masterId,
					points: [
						{
							pointId: "point:join:soft:source:0",
							x: 0,
							y: index * 10,
						},
						{
							pointId: "point:join:soft:source:1",
							x: 100,
							y: index * 10,
							incoming: { x: -20, y: sourceIncomingY },
						},
						{
							pointId: "point:join:soft:target:0",
							x: 110,
							y: index * 10,
							incoming: { x: -30, y: 0 },
							outgoing: { x: 30, y: 0 },
						},
						{
							pointId: "point:join:soft:target:1",
							x: 210,
							y: index * 10,
						},
					],
				})),
			})
			editor.actions.joinOpenContours({
				glyphId: oGlyphId,
				draggedContourId: "contour:join:soft:source",
				draggedPointId: "point:join:soft:source:1",
				targetContourId: "contour:join:soft:target",
				targetPointId: "point:join:soft:target:0",
			})
			expect(
				editor.silo.getState(editor.atoms.point, [
					oGlyphId,
					"point:join:soft:target:0",
				]),
			).toEqual({ mode: expectedMode })
			for (const [masterId, index] of [
				[razorMasterId, 0],
				[blackMasterId, 1],
			] as const) {
				const survivor = editor.read.layerNode(
					masterId,
					oGlyphId,
					"point:join:soft:target:0",
				)
				if (!survivor.ok) throw new Error("Joined survivor is missing.")
				expect(survivor.value.x).toBe(110)
				expect(survivor.value.y).toBe(index * 10)
				expect(survivor.value.incoming).toEqual({
					x: -30,
					y: sourceIncomingY,
				})
				expect(survivor.value.outgoing).toEqual({ x: 30, y: 0 })
			}
		}
	})

	it("diagnoses deferred overlap union without destroying editable topology", () => {
		const source = makeGeometricOEditorFont()
		const glyph = source.glyphs.find((candidate) => candidate.id === oGlyphId)
		if (glyph === undefined) throw new Error("Fixture glyph is missing.")
		Object.assign(glyph, { overlap: true })
		const editor = createFontEditorState({ key: "test/overlap-union-deferred" })
		editor.actions.load(source)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("compiled")
		expect(compilation.projectionWarnings).toContainEqual(
			expect.objectContaining({
				code: "overlap.union_deferred",
				entityId: oGlyphId,
				path: `$.glyphs[${oGlyphId}].overlap`,
			}),
		)
		expect(editor.read.editorSource()?.glyphs[1]?.contours).toEqual(
			glyph.contours,
		)
	})
})
