// @vitest-environment happy-dom

import type { SourceChangeGroup } from "@create-art/source-rpc"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignVersionControlTile } from "../src/DesignVersionControlTile.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"

const changes: readonly SourceChangeGroup[] = [
	{
		change: "modified",
		id: "object:poster",
		kind: "object",
		label: "Poster",
		paths: ["scene/objects/poster.json"],
	},
	{
		change: "modified",
		id: "design:coordinated-structure",
		kind: "structure",
		label: "Coordinated design structure",
		paths: ["scene/layers/index.json", "scene/objects/index.json"],
	},
	{
		change: "added",
		id: "design:assets",
		kind: "asset",
		label: "Assets",
		paths: ["assets/index.json", "assets/poster.png"],
	},
]

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

describe("create-design Version Control tile", () => {
	it("presents semantic kinds and delegates only meaningful design navigation", () => {
		const reviewSourceChange = vi.fn()
		const context = {
			canReviewSourceChange: (change: SourceChangeGroup) =>
				change.kind !== "asset",
			reviewSourceChange,
			versionControl: {
				comparison: {
					base: { identity: "base", kind: "ref", label: "HEAD" },
					changes,
					identity: "comparison",
					target: {
						identity: "working",
						kind: "working",
						label: "Working source",
					},
				},
				loading: false,
				onCommit: vi.fn(async () => undefined),
				onCompare: vi.fn(async () => undefined),
			},
		} as unknown as DesignTileContext
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		act(() => render(h(DesignVersionControlTile, { context }), host))

		expect(host.textContent).toContain("Design object")
		expect(host.textContent).toContain("Coordinated design structure")
		expect(host.textContent).toContain("Asset inventory and binary files")
		const object = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Review Design object: Poster"]',
		)
		const asset = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Assets"),
		)
		expect(object?.disabled).toBe(false)
		expect(asset?.disabled).toBe(true)
		act(() => object?.click())
		expect(reviewSourceChange).toHaveBeenCalledExactlyOnceWith(changes[0])
	})
})
