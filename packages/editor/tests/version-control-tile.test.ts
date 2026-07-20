// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { makeDemoFont, oGlyphId } from "../src/demo-font.ts"
import { VersionControlTile } from "../src/VersionControlTile.tsx"
import type { EditorVersionControl } from "../src/version-control.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function versionControl(
	overrides: Partial<EditorVersionControl> = {},
): EditorVersionControl {
	const source = makeDemoFont()
	return {
		loading: false,
		onCompare: vi.fn(async () => undefined),
		onCommit: vi.fn(async () => undefined),
		comparison: {
			base: {
				identity: "base-commit",
				kind: "ref",
				label: "HEAD",
				ref: "HEAD",
				source,
			},
			changes: [
				{
					change: "modified",
					id: oGlyphId,
					kind: "glyph",
					label: "O",
					paths: ["glyphs/o.json"],
				},
				{
					change: "modified",
					id: "source:names.json",
					kind: "source",
					label: "names.json",
					paths: ["names.json"],
				},
			],
			identity: "comparison-1",
			target: {
				identity: "working-1",
				kind: "working",
				label: "Working source",
				source,
			},
		},
		...overrides,
	}
}

function mount(options = versionControl()) {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const review = vi.fn()
	act(() =>
		render(
			h(VersionControlTile, {
				onReviewGlyph: review,
				versionControl: options,
			}),
			host,
		),
	)
	return { host, options, review }
}

describe("VersionControlTile", () => {
	it("reports endpoints and reviews changed glyphs", () => {
		const { host, review } = mount()
		expect(host.textContent).toContain("HEAD → Working source")
		expect(host.textContent).toContain("2 total")
		const glyph = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Omodified"),
		)
		if (!(glyph instanceof HTMLButtonElement))
			throw new Error("Changed glyph action not found.")
		act(() => glyph.click())
		expect(review).toHaveBeenCalledExactlyOnceWith(oGlyphId)
	})

	it("uses selection then message steps and submits exact paths", async () => {
		const { host, options } = mount()
		const start = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Start Commit",
		)
		if (!(start instanceof HTMLButtonElement))
			throw new Error("Start Commit missing.")
		act(() => start.click())
		const checkboxes = host.querySelectorAll<HTMLInputElement>(
			'input[type="checkbox"]',
		)
		expect(checkboxes).toHaveLength(2)
		act(() => {
			checkboxes[1]!.checked = false
			checkboxes[1]!.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.textContent).toContain("1 source unit will remain uncommitted")
		const continueButton = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		)
		if (!(continueButton instanceof HTMLButtonElement))
			throw new Error("Continue missing.")
		act(() => continueButton.click())
		const textarea = host.querySelector("textarea")
		if (!(textarea instanceof HTMLTextAreaElement))
			throw new Error("Message missing.")
		act(() => {
			textarea.value = "Review O"
			textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const confirm = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Commit selected units",
		)
		if (!(confirm instanceof HTMLButtonElement))
			throw new Error("Confirm missing.")
		await act(async () => {
			confirm.click()
			await Promise.resolve()
		})
		expect(options.onCommit).toHaveBeenCalledExactlyOnceWith({
			expectedComparisonIdentity: "comparison-1",
			message: "Review O",
			paths: ["glyphs/o.json"],
		})
	})

	it("retains the message and selection when commit fails", async () => {
		const onCommit = vi.fn(async () => {
			throw new Error("Repository changed")
		})
		const { host } = mount(versionControl({ onCommit }))
		const start = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Start Commit",
		) as HTMLButtonElement
		act(() => start.click())
		const continueButton = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		) as HTMLButtonElement
		act(() => continueButton.click())
		const textarea = host.querySelector("textarea") as HTMLTextAreaElement
		act(() => {
			textarea.value = "Keep this message"
			textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const confirm = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Commit selected units",
		) as HTMLButtonElement
		await act(async () => {
			confirm.click()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(host.querySelector("textarea")?.value).toBe("Keep this message")
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"Repository changed",
		)
	})
})
