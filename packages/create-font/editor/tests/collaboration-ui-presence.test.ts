// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EditorCollaborationSession } from "../src/browser-api.ts"
import { participantColor } from "../src/collaboration-presence.ts"
import { CollaborationUiPresence } from "../src/CollaborationUiPresence.tsx"
import { measureUiPresence } from "../src/use-editor-collaboration-presence.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		act(() => render(null, host))
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
})

function mount(session: EditorCollaborationSession): HTMLElement {
	const host = document.createElement(`section`)
	document.body.append(host)
	hosts.push(host)
	act(() => render(h(CollaborationUiPresence, { session }), host))
	return host
}

describe(`collaboration UI presence`, () => {
	it(`normalizes visible lane-clipped columns and a column-relative cursor`, () => {
		vi.spyOn(window, `innerWidth`, `get`).mockReturnValue(1_000)
		vi.spyOn(window, `innerHeight`, `get`).mockReturnValue(800)
		const root = document.createElement(`editor-workspace`)
		const lane = document.createElement(`tile-lane`)
		const column = document.createElement(`tile-column`)
		const target = document.createElement(`button`)
		column.append(target)
		lane.append(column)
		root.append(lane)
		vi.spyOn(lane, `getBoundingClientRect`).mockReturnValue(
			DOMRect.fromRect({ x: 0, y: 50, width: 300, height: 400 }),
		)
		vi.spyOn(column, `getBoundingClientRect`).mockReturnValue(
			DOMRect.fromRect({ x: 10, y: 20, width: 200, height: 480 }),
		)

		expect(measureUiPresence(root, { x: 110, y: 250, target })).toEqual({
			columns: [{ minX: 0.01, minY: 0.0625, maxX: 0.21, maxY: 0.5625 }],
			cursor: { column: 0, x: 0.5, y: 0.5 },
		})
	})

	it(`projects remote columns and anchors the cursor above its column`, () => {
		const session: EditorCollaborationSession = {
			deviceId: `local`,
			participants: [
				{
					connected: true,
					connectedAt: 1,
					identity: {
						deviceId: `remote`,
						email: `remote@example.test`,
						name: `Remote Editor`,
						publicKey: `test-public-key`,
					},
					role: `editor`,
				},
			],
			pending: [],
			presence: [
				{
					context: { surface: `canvas` },
					cursor: null,
					deviceId: `remote`,
					gesture: null,
					selection: [],
					ui: {
						columns: [
							{ minX: 0.1, minY: 0.2, maxX: 0.3, maxY: 0.8 },
							{ minX: 0.6, minY: 0.1, maxX: 0.9, maxY: 0.9 },
						],
						cursor: { column: 0, x: 0.5, y: 0.25 },
					},
				},
			],
			role: `owner`,
			status: `connected`,
		}
		const host = mount(session)
		const columns = host.querySelectorAll<HTMLElement>(`remote-ui-column`)
		const cursor = host.querySelector<HTMLElement>(`remote-ui-cursor`)

		expect(columns).toHaveLength(2)
		expect(columns[0]?.style.left).toBe(`10%`)
		expect(columns[0]?.style.top).toBe(`20%`)
		expect(columns[0]?.style.width).toBe(`20%`)
		expect(Number.parseFloat(columns[0]?.style.height ?? ``)).toBeCloseTo(60)
		expect(cursor?.style.left).toBe(`20%`)
		expect(cursor?.style.top).toBe(`35%`)
		expect(cursor?.style.getPropertyValue(`--presence-color`)).toBe(
			participantColor(`remote`),
		)
		expect(cursor?.textContent).toContain(`Remote Editor`)
	})
})
