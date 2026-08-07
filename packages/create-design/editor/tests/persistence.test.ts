import { describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import {
	clearDesignRecoveryDraft,
	createDesignPersistenceState,
	DESIGN_RECOVERY_STORAGE_KEY,
	isDesignRecoveryDraftNewer,
	persistenceNeedsUnloadWarning,
	readDesignRecoveryDraft,
	reduceDesignPersistence,
	writeDesignRecoveryDraft,
	type DesignPersistenceAction,
	type DesignPersistenceState,
} from "../src/persistence.ts"

function transition(
	state: DesignPersistenceState,
	...actions: readonly DesignPersistenceAction[]
): DesignPersistenceState {
	return actions.reduce(reduceDesignPersistence, state)
}

describe("create-design persistence state machine", () => {
	it("deterministically models dirty, queued, saving, and saved revisions", () => {
		const saved = createDesignPersistenceState("source:a")
		const saving = transition(
			saved,
			{ type: "edit" },
			{ type: "queue" },
			{ type: "save-started", revision: 1 },
		)
		expect(saving).toMatchObject({
			status: "saving",
			durableRevision: "source:a",
			localRevision: 1,
			savingRevision: 1,
		})

		const durable = reduceDesignPersistence(saving, {
			type: "save-succeeded",
			revision: 1,
			durableRevision: "source:b",
		})
		expect(durable).toMatchObject({
			status: "saved",
			durableRevision: "source:b",
			localRevision: 1,
			savingRevision: null,
		})
	})

	it("advances the durable revision without clearing edits newer than the write", () => {
		const saving = transition(
			createDesignPersistenceState("source:a"),
			{ type: "edit" },
			{ type: "queue" },
			{ type: "save-started", revision: 1 },
			{ type: "edit" },
		)
		const completed = reduceDesignPersistence(saving, {
			type: "save-succeeded",
			revision: 1,
			durableRevision: "source:b",
		})
		expect(completed).toMatchObject({
			status: "dirty",
			durableRevision: "source:b",
			localRevision: 2,
		})
	})

	it("ignores stale completions and retains failed work for an explicit retry", () => {
		const saving = transition(
			createDesignPersistenceState("source:a"),
			{ type: "edit" },
			{ type: "queue" },
			{ type: "save-started", revision: 1 },
		)
		expect(
			reduceDesignPersistence(saving, {
				type: "save-succeeded",
				revision: 0,
				durableRevision: "stale",
			}),
		).toBe(saving)
		const conflicted = reduceDesignPersistence(saving, {
			type: "save-failed",
			revision: 1,
			message: "revision conflict",
		})
		expect(conflicted).toMatchObject({
			status: "conflicted",
			durableRevision: "source:a",
			localRevision: 1,
			message: "revision conflict",
		})
		expect(
			reduceDesignPersistence(conflicted, { type: "retry" }),
		).toMatchObject({ status: "queued", queuedRevision: 1 })
	})

	it("preserves recoverable and invalid-source states until an explicit action", () => {
		const document = createInitialDocument()
		const draft = {
			version: 1 as const,
			baseRevision: "source:a",
			document: { ...document, title: "Recovered" },
			updatedAt: 42,
		}
		const recoverable = reduceDesignPersistence(
			createDesignPersistenceState("source:b"),
			{ type: "recovery-found", draft },
		)
		expect(recoverable).toMatchObject({
			status: "recoverable-draft",
			durableRevision: "source:b",
			recoveryDraft: draft,
		})
		expect(
			reduceDesignPersistence(recoverable, { type: "recover-draft" }),
		).toMatchObject({ status: "dirty", durableRevision: "source:b" })
		expect(
			reduceDesignPersistence(recoverable, { type: "discard-draft" }),
		).toMatchObject({
			status: "saved",
			durableRevision: "source:b",
			recoveryDraft: null,
		})

		const invalid = reduceDesignPersistence(
			createDesignPersistenceState("source:b"),
			{
				type: "external-invalid",
				diagnostics: [
					{
						severity: "error",
						code: "source.schema",
						unitPath: "document.json",
						path: "$.title",
						message: "Expected string.",
					},
				],
			},
		)
		expect(invalid).toMatchObject({
			status: "invalid-external-source",
			durableRevision: "source:b",
		})
		expect(invalid.diagnostics[0]).toMatchObject({
			unitPath: "document.json",
			path: "$.title",
		})
	})

	it("preserves local work through an external conflict until external reload wins", () => {
		const dirty = reduceDesignPersistence(
			createDesignPersistenceState("source:a"),
			{ type: "edit" },
		)
		const conflicted = reduceDesignPersistence(dirty, {
			type: "external-conflict",
			message: "Source changed on disk.",
		})
		expect(conflicted).toMatchObject({
			status: "conflicted",
			durableRevision: "source:a",
			localRevision: 1,
		})
		expect(
			reduceDesignPersistence(conflicted, {
				type: "external-loaded",
				durableRevision: "source:b",
			}),
		).toMatchObject({
			status: "saved",
			durableRevision: "source:b",
			localRevision: 0,
			persistedLocalRevision: 0,
		})
	})

	it.each([
		["saved", false],
		["dirty", true],
		["queued", true],
		["saving", true],
		["conflicted", true],
		["invalid-external-source", false],
		["recoverable-draft", false],
	] as const)(
		"uses the documented unload policy for %s",
		(status, expected) => {
			expect(
				persistenceNeedsUnloadWarning({
					status,
					localRevision: 0,
					persistedLocalRevision: 0,
				}),
			).toBe(expected)
		},
	)

	it("warns for local edits even while an invalid source or recovery prompt is visible", () => {
		for (const status of [
			"invalid-external-source",
			"recoverable-draft",
		] as const)
			expect(
				persistenceNeedsUnloadWarning({
					status,
					localRevision: 2,
					persistedLocalRevision: 1,
				}),
			).toBe(true)
	})
})

describe("create-design recovery storage", () => {
	it("suppresses stale durable copies but offers divergent drafts from older revisions", () => {
		const durable = createInitialDocument()
		const reordered = {
			artboards: durable.artboards,
			layers: durable.layers,
			groups: durable.groups,
			guides: durable.guides,
			objects: durable.objects,
			swatches: durable.swatches,
			title: durable.title,
			version: durable.version,
			format: durable.format,
		}
		expect(
			isDesignRecoveryDraftNewer(
				{
					version: 1,
					baseRevision: "source:current",
					document: reordered,
					updatedAt: 42,
				},
				durable,
			),
		).toBe(false)
		expect(
			isDesignRecoveryDraftNewer(
				{
					version: 1,
					baseRevision: "source:older",
					document: { ...durable, title: "Unsaved divergent draft" },
					updatedAt: 43,
				},
				durable,
			),
		).toBe(true)
	})

	it("round-trips a separate recovery draft and rejects malformed data", () => {
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		}
		const draft = {
			version: 1 as const,
			baseRevision: "source:a",
			document: createInitialDocument(),
			updatedAt: 42,
		}
		writeDesignRecoveryDraft(storage, draft)
		expect(readDesignRecoveryDraft(storage)).toEqual(draft)
		expect(values.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(true)
		clearDesignRecoveryDraft(storage)
		expect(readDesignRecoveryDraft(storage)).toBeNull()
		values.set(DESIGN_RECOVERY_STORAGE_KEY, `{"version":2}`)
		expect(readDesignRecoveryDraft(storage)).toBeNull()
	})

	it("migrates a legacy complete document embedded in a recovery draft", () => {
		const legacy = {
			version: 1,
			baseRevision: "source:legacy",
			updatedAt: 42,
			document: {
				format: "create-design.document",
				version: 1,
				title: "Recovered legacy design",
				page: { width: 100, height: 100 },
				swatches: [
					{
						id: "swatch:ink",
						name: "Ink",
						source: { space: "rgb", r: 0, g: 0, b: 0 },
					},
				],
				objects: [
					{
						id: "object:legacy",
						name: "Legacy",
						contours: [{ closed: false, points: [{ x: 1, y: 2 }] }],
						fillId: "swatch:ink",
					},
				],
				guides: [],
			},
		}
		const storage = {
			getItem: () => JSON.stringify(legacy),
		}
		expect(readDesignRecoveryDraft(storage)).toMatchObject({
			document: {
				version: 7,
				artboards: [
					{
						id: "artboard:page",
						name: "Artboard 1",
						x: 0,
						y: 0,
						width: 100,
						height: 100,
					},
				],
				objects: [
					{
						geometry: { kind: "path" },
						appearance: { fill: { swatchId: "swatch:ink" } },
					},
				],
			},
		})
	})

	it("treats unavailable browser storage as best-effort", () => {
		const unavailable = {
			getItem(): string | null {
				throw new Error("denied")
			},
			setItem(): void {
				throw new Error("denied")
			},
			removeItem(): void {
				throw new Error("denied")
			},
		}
		expect(readDesignRecoveryDraft(unavailable)).toBeNull()
		expect(() =>
			writeDesignRecoveryDraft(unavailable, {
				version: 1,
				baseRevision: "source:a",
				document: createInitialDocument(),
				updatedAt: 42,
			}),
		).not.toThrow()
		expect(() => clearDesignRecoveryDraft(unavailable)).not.toThrow()
	})
})
