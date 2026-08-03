// @vitest-environment happy-dom

import { StoreProvider, useO, useTL } from "atom.io/react"
import { h, render } from "preact"
import { act } from "preact/test-utils"
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
	const document = useO(state.states.documentAtom)
	const history = useTL(state.timelines.documentTimeline)
	return h(
		"output",
		{
			"data-at": history.at,
			"data-length": history.length,
		},
		document.title,
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
				...state.silo.getState(state.states.documentAtom),
				title: "Observed",
			}),
		)

		expect(host.querySelector("output")?.textContent).toBe("Observed")
		expect(host.querySelector("output")?.getAttribute("data-at")).toBe("1")
		expect(host.querySelector("output")?.getAttribute("data-length")).toBe("1")
	})
})
