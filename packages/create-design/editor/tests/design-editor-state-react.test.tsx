// @vitest-environment happy-dom

import { StoreProvider, useO } from "atom.io/react"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import {
	createDesignEditorState,
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
	return h(
		"output",
		{
			"data-past": snapshot.history.pastLength,
			"data-future": snapshot.history.futureLength,
		},
		snapshot.document.title,
	)
}

describe("create-design atom.io React bindings", () => {
	it("observes the supplied Silo and timeline through StoreProvider", () => {
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

		act(() =>
			state.actions.commitDocument({
				...state.silo.getState(state.states.documentSelector),
				title: "Observed",
			}),
		)

		expect(host.querySelector("output")?.textContent).toBe("Observed")
		expect(host.querySelector("output")?.getAttribute("data-past")).toBe("1")
		expect(host.querySelector("output")?.getAttribute("data-future")).toBe("0")

		act(() => {
			state.actions.navigateDocumentHistory("undo")
		})
		expect(host.querySelector("output")?.textContent).toBe("Initial")
		expect(host.querySelector("output")?.getAttribute("data-past")).toBe("0")
		expect(host.querySelector("output")?.getAttribute("data-future")).toBe("1")
	})
})
