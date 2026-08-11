// @vitest-environment happy-dom

import type { GlyphId } from "@create-font/states"
import { Silo } from "atom.io"
import { StoreProvider, useO, useTL } from "atom.io/react"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import { AppShell } from "../src/AppShell.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		act(() => render(null, host))
		host.remove()
	}
	hosts.length = 0
})

describe("atom.io React integration", () => {
	it("exposes a keyboard-native workspace font selector", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.navigate("/glyphs")
		const changes: string[] = []
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(AppShell, {
						workspace,
						workspaceProject: {
							id: "alpha",
							onChange: (id: string) => {
								changes.push(id)
								return true
							},
							projects: [
								{ id: "alpha", name: "Alpha", path: "fonts/alpha" },
								{ id: "beta", name: "Beta", path: "fonts/beta" },
							],
						},
					}),
				}),
				host,
			),
		)
		const select = host.querySelector<HTMLSelectElement>(
			'select[aria-label="Active workspace font"]',
		)
		expect(select?.value).toBe("alpha")
		expect([...select!.options].map(({ text }) => text)).toEqual([
			"Alpha",
			"Beta",
		])
		act(() => {
			select!.value = "beta"
			select!.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(changes).toEqual(["beta"])

		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(AppShell, {
						workspace,
						workspaceProject: {
							id: "alpha",
							onChange: () => false,
							projects: [{ id: "alpha", name: "Alpha", path: "fonts/alpha" }],
						},
					}),
				}),
				host,
			),
		)
		expect(
			host.querySelector('select[aria-label="Active workspace font"]'),
		).toBeNull()
		expect(host.querySelector("project-name > strong")?.textContent).toBe(
			"create-font",
		)
	})

	it("owns independently established interaction facts in granular atoms", () => {
		const workspace = createEditorWorkspace()
		const factTokens = [
			workspace.ui.selectedGlyphId,
			workspace.ui.activeMasterId,
			workspace.ui.comparisonMasterId,
			workspace.ui.selection,
			workspace.ui.previewText,
			workspace.ui.caretIndex,
			workspace.ui.textSelectionCollapsed,
			workspace.ui.textSelectionRange,
			workspace.ui.editingTextIndex,
			workspace.ui.activeTool,
			workspace.ui.selectedRuleIds,
			workspace.ui.pathname,
		]

		expect(factTokens.every((token) => token.type === "atom")).toBe(true)
		expect(new Set(factTokens.map((token) => token.key)).size).toBe(
			factTokens.length,
		)
		expect(workspace.ui.previewCoordinate.type).toBe("atom_family")
		expect(workspace.ui.activeGlyphId.type).toBe("readonly_pure_selector")
		expect(workspace.font.silo.store.atoms.has("interaction")).toBe(false)
		const assertLoadRejectsMismatchedCoWrites = () => {
			workspace.font.actions.load(workspace.document, [
				// @ts-expect-error A co-write value must match its atom's value type.
				{
					atom: workspace.ui.previewText,
					value: 42,
				},
			])
		}
		void assertLoadRejectsMismatchedCoWrites
	})

	it("notifies direct subscribers only after a transaction is fully settled", () => {
		const silo = new Silo({
			name: "settled-transaction-subscribers",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const firstAtom = silo.atom({ key: "first", default: "old first" })
		const secondAtom = silo.atom({ key: "second", default: "old second" })
		const updateTransaction = silo.transaction<() => void>({
			key: "updateBoth",
			do: ({ set }) => {
				set(firstAtom, "new first")
				set(secondAtom, "new second")
			},
		})
		const snapshots: Array<readonly [string, string, string]> = []
		const readSnapshot = (source: string) => {
			snapshots.push([
				source,
				silo.getState(firstAtom),
				silo.getState(secondAtom),
			])
		}
		const unsubscribeFirst = silo.subscribe(firstAtom, () =>
			readSnapshot("first"),
		)
		const unsubscribeSecond = silo.subscribe(secondAtom, () =>
			readSnapshot("second"),
		)

		silo.runTransaction(updateTransaction)()
		unsubscribeFirst()
		unsubscribeSecond()

		expect(snapshots).toHaveLength(2)
		expect(snapshots).toEqual(
			expect.arrayContaining([
				["first", "new first", "new second"],
				["second", "new first", "new second"],
			]),
		)
	})

	it("composes an unmaterialized selector-family member inside a transaction", () => {
		const silo = new Silo({
			name: "transaction-selector-family-composition",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const values = silo.atomFamily<string, string>({
			key: "compositionValues",
			default: (key) => key,
		})
		const lengths = silo.selectorFamily<number, string>({
			key: "compositionLengths",
			get:
				(key) =>
				({ get }) =>
					get(values, key).length,
		})
		const documentSelector = silo.selector<{ readonly length: number }>({
			key: "compositionDocument",
			get: ({ get }) => ({ length: get(lengths, "fresh") }),
		})
		const readDocument = silo.transaction<() => { readonly length: number }>({
			key: "readCompositionDocument",
			do: ({ get }) => get(documentSelector),
		})

		expect(silo.runTransaction(readDocument)()).toEqual({ length: 5 })
	})

	it("renders coordinated workspace transactions as settled state", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.activeTool, "pen")
		const snapshots: Array<readonly [string | null, string]> = []
		function Harness() {
			const glyphId = useO(workspace.ui.selectedGlyphId)
			const tool = useO(workspace.ui.activeTool)
			snapshots.push([glyphId, tool])
			return null
		}
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(Harness, {}),
				}),
				host,
			),
		)

		act(() => workspace.actions.selectGlyph(oGlyphId))

		expect(snapshots.at(-1)).toEqual([oGlyphId, "select"])
		expect(snapshots).not.toContainEqual([oGlyphId, "pen"])
	})

	it("unmounts glyph history without recreating a disposed family member", () => {
		const workspace = createEditorWorkspace()
		const removedTimeline = workspace.font.silo.findTimeline(
			workspace.font.glyphHistoryTimelines,
			oGlyphId,
		)
		function GlyphHistory({ glyphId }: { readonly glyphId: GlyphId }) {
			useTL(workspace.font.glyphHistoryTimelines, glyphId)
			return null
		}
		function Harness() {
			const activeGlyphId = useO(workspace.ui.activeGlyphId)
			return activeGlyphId === null
				? null
				: h(GlyphHistory, { glyphId: activeGlyphId })
		}
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(Harness, {}),
				}),
				host,
			),
		)

		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Fixture source is missing.")
		act(() =>
			workspace.actions.replaceSource({
				...source,
				glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
				cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
				kerning: (source.kerning ?? []).filter(
					(pair) => pair.left !== oGlyphId && pair.right !== oGlyphId,
				),
			}),
		)
		expect(workspace.font.silo.store.timelines.has(removedTimeline.key)).toBe(
			false,
		)
	})

	it("preserves shell-local state when active glyph history disappears", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.navigate("/glyphs")
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(AppShell, { workspace }),
				}),
				host,
			),
		)
		const openCommands = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (openCommands === null) throw new Error("Command button is missing.")
		act(() => openCommands.click())
		expect(host.querySelector("command-palette")).not.toBeNull()

		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Fixture source is missing.")
		act(() =>
			workspace.actions.replaceSource({
				...source,
				glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
				cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
				kerning: (source.kerning ?? []).filter(
					(pair) => pair.left !== oGlyphId && pair.right !== oGlyphId,
				),
			}),
		)

		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBeNull()
		expect(host.querySelector("command-palette")).not.toBeNull()
	})
})
