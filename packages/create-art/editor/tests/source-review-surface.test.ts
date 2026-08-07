// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SourceReviewSurface } from "../src/SourceReviewSurface.tsx"
import {
	selectedSourceReviewPaths,
	sourceReviewCounts,
	type SourceReviewChange,
	type SourceReviewController,
} from "../src/source-review.ts"

type DesignReviewChange = SourceReviewChange &
	Readonly<{ kind: "asset" | "object" | "structure" }>

const changes: readonly DesignReviewChange[] = [
	{
		change: "modified",
		id: "object:poster",
		kind: "object",
		label: "Poster",
		paths: ["objects/poster.json", "document.json"],
	},
	{
		change: "modified",
		id: "structure:document",
		kind: "structure",
		label: "Document structure",
		paths: ["document.json"],
	},
	{
		change: "added",
		id: "asset:photo",
		kind: "asset",
		label: "Photo",
		paths: ["assets.json", "assets/photo.png"],
	},
]

function controller(
	overrides: Partial<SourceReviewController<DesignReviewChange>> = {},
): SourceReviewController<DesignReviewChange> {
	return {
		loading: false,
		onCommit: vi.fn(async () => undefined),
		onCompare: vi.fn(async () => undefined),
		comparison: {
			base: {
				identity: "base",
				kind: "ref",
				label: "HEAD",
				ref: "HEAD",
			},
			changes,
			identity: "comparison",
			target: {
				identity: "working",
				kind: "working",
				label: "Working source",
			},
		},
		...overrides,
	}
}

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mount(options = controller()) {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const review = vi.fn()
	act(() =>
		render(
			h(SourceReviewSurface<DesignReviewChange>, {
				controller: options,
				review: {
					canReview: (change) => change.kind === "object",
					review,
					reviewLabel: (change) => `Inspect ${change.label}`,
				},
			}),
			host,
		),
	)
	return { host, options, review }
}

describe("product-neutral source review", () => {
	it("uses the primary shared button and trims comparison refs", () => {
		const { host, options } = mount()
		const inputs = host.querySelectorAll("comparison-controls input")
		const compare = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Compare",
		)
		expect(compare?.closest("tile-button")).not.toBeNull()
		expect(compare?.dataset.tone).toBe("primary")
		expect(compare?.type).toBe("button")
		expect(compare?.disabled).toBe(false)
		act(() => {
			const base = inputs[0] as HTMLInputElement
			const target = inputs[1] as HTMLInputElement
			base.value = "  feature/base  "
			target.value = "   "
			base.dispatchEvent(new InputEvent("input", { bubbles: true }))
			target.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		act(() => compare?.click())
		expect(options.onCompare).toHaveBeenCalledExactlyOnceWith(
			"feature/base",
			undefined,
		)
	})

	it("disables the shared Compare button while loading", () => {
		const { host } = mount(controller({ loading: true }))
		const compare = host.querySelector<HTMLButtonElement>(
			"button[data-source-review-compare]",
		)
		expect(compare?.closest("tile-button")).not.toBeNull()
		expect(compare?.dataset.tone).toBe("primary")
		expect(compare?.disabled).toBe(true)
		expect(compare?.textContent).toBe("Comparing…")
		expect(
			host.querySelector("comparison-status")?.getAttribute("data-state"),
		).toBe("loading")
	})

	it("accepts application kinds and delegates only reviewable rows", () => {
		const { host, review } = mount()
		expect(host.textContent).toContain("3 total")
		const object = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Inspect Poster"]',
		)
		const structure = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Document structure"),
		)
		expect(object?.disabled).toBe(false)
		expect(structure?.disabled).toBe(true)
		expect(object?.querySelector("span")?.title).toBe("Poster")
		act(() => object?.click())
		expect(review).toHaveBeenCalledExactlyOnceWith(changes[0])
	})

	it("hides zero-value counts and exposes full truncated row context", () => {
		const { host } = mount()
		const counts = host.querySelector("change-counts")
		expect(counts?.textContent).toContain("1 added")
		expect(counts?.textContent).toContain("2 modified")
		expect(counts?.textContent).not.toContain("deleted")
		const unavailable = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Document structure"),
		)
		expect(unavailable?.getAttribute("aria-label")).toBe(
			"Document structure; modified; review unavailable",
		)
		expect(unavailable?.querySelector("span")?.title).toBe("Document structure")
		expect(
			host.querySelector('tile-button > button[data-tone="primary"]'),
		).not.toBeNull()
	})

	it("deduplicates paths when selected semantic groups overlap", () => {
		expect(
			selectedSourceReviewPaths(
				changes,
				new Set(["object\0object:poster", "structure\0structure:document"]),
			),
		).toEqual(["objects/poster.json", "document.json"])
		expect(sourceReviewCounts(changes)).toEqual({
			added: 1,
			deleted: 0,
			modified: 2,
			total: 3,
		})
	})

	it("reports unavailable, loading, error, and empty states", () => {
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(SourceReviewSurface<SourceReviewChange>, {
					renderChange: (change) => change.label,
				}),
				host,
			),
		)
		expect(host.textContent).toContain("unavailable")
		act(() =>
			render(
				h(SourceReviewSurface, {
					controller: controller({ loading: true }),
				}),
				host,
			),
		)
		expect(host.textContent).toContain("Loading source changes")
		act(() =>
			render(
				h(SourceReviewSurface, {
					controller: controller({
						error: "Conflict: source changed externally",
						loading: false,
					}),
				}),
				host,
			),
		)
		expect(host.textContent).toContain("Conflict: source changed externally")
		act(() =>
			render(
				h(SourceReviewSurface, {
					controller: controller({
						comparison: {
							...controller().comparison!,
							changes: [],
						},
					}),
				}),
				host,
			),
		)
		expect(host.textContent).toContain("No source differences")
	})

	it("moves focus through the keyboard commit flow and restores it on Escape", async () => {
		const { host } = mount()
		const start = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Start Commit",
		) as HTMLButtonElement
		act(() => start.click())
		await act(
			async () =>
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => resolve()),
				),
		)
		const close = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Close commit dialog"]',
		)
		expect(document.activeElement).toBe(close)

		const continueButton = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		) as HTMLButtonElement
		act(() => continueButton.click())
		await act(
			async () =>
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => resolve()),
				),
		)
		const textarea = host.querySelector("textarea")
		expect(document.activeElement).toBe(textarea)

		const dialog = host.querySelector("dialog") as HTMLDialogElement
		act(() => {
			dialog.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
		})
		await act(
			async () =>
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => resolve()),
				),
		)
		expect(host.querySelector("dialog")).toBeNull()
		expect(document.activeElement).toBe(start)
	})

	it("keeps commit input after an error and closes with Escape", async () => {
		const options = controller({
			onCommit: vi.fn(async () => {
				throw new Error("Comparison is stale")
			}),
		})
		const { host } = mount(options)
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
			textarea.value = "Keep this"
			textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const commit = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Commit selected units",
		) as HTMLButtonElement
		await act(async () => {
			commit.click()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(host.querySelector("textarea")?.value).toBe("Keep this")
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"Comparison is stale",
		)
		const dialog = host.querySelector("dialog") as HTMLDialogElement
		act(() => {
			dialog.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
		})
		expect(host.querySelector("dialog")).toBeNull()
	})
})
