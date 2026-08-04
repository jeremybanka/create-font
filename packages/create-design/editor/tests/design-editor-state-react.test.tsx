// @vitest-environment happy-dom

import { StoreProvider, useO, useTL } from "atom.io/react"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import {
	createDesignEditorState,
	DESIGN_HISTORY_UNDO_LIMIT,
	type DesignEditorState,
} from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) render(null, host)
	hosts.length = 0
})

function StateOutput({ state }: Readonly<{ state: DesignEditorState }>) {
	const snapshot = useO(state.states.snapshotSelector)
	const { at, length, redo, undo } = useTL(state.documentTimeline)
	return h(
		"section",
		null,
		h(
			"output",
			{
				"data-at": at,
				"data-length": length,
			},
			snapshot.document.title,
		),
		h("button", { type: "button", onClick: undo }, "Undo"),
		h("button", { type: "button", onClick: redo }, "Redo"),
	)
}

describe("create-design atom.io React bindings", () => {
	it("observes the supplied Silo document and bounded timeline through StoreProvider", () => {
		const state = createDesignEditorState({
			document: { ...createInitialDocument(), title: "Initial" },
			persistence: createDesignPersistenceState(null),
			name: "react-test",
		})
		const host = document.createElement("main")
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: state.silo.store,
					children: h(StateOutput, { state }),
				}),
				host,
			),
		)

		act(() => {
			for (let index = 1; index <= DESIGN_HISTORY_UNDO_LIMIT + 1; index += 1) {
				state.actions.commitDocument({
					...state.silo.getState(state.states.documentAtom),
					title: `Observed ${index}`,
				})
			}
		})

		const output = host.querySelector("output")
		expect(output?.textContent).toBe("Observed 101")
		expect(output?.getAttribute("data-at")).toBe("100")
		expect(output?.getAttribute("data-length")).toBe("100")

		const buttons = host.querySelectorAll<HTMLButtonElement>("button")
		act(() => buttons[0]?.click())
		expect(output?.textContent).toBe("Observed 100")
		expect(output?.getAttribute("data-at")).toBe("99")
		expect(output?.getAttribute("data-length")).toBe("100")

		act(() => buttons[1]?.click())
		expect(output?.textContent).toBe("Observed 101")
		expect(output?.getAttribute("data-at")).toBe("100")

		act(() => {
			state.actions.resetDocument({
				...state.silo.getState(state.states.documentAtom),
				title: "Rebased",
			})
		})
		expect(output?.textContent).toBe("Rebased")
		expect(output?.getAttribute("data-at")).toBe("0")
		expect(output?.getAttribute("data-length")).toBe("0")
	})
})
