// @vitest-environment happy-dom

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CurvatureCombControls } from "../src/CurvatureCombControls.tsx"
import { isCurvatureShortcut } from "../src/curvature-comb.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

describe("curvature comb controls", () => {
	it("matches the platform shortcut without foreign modifiers", () => {
		const event = {
			altKey: false,
			ctrlKey: false,
			key: "X",
			metaKey: true,
			shiftKey: true,
		}
		expect(isCurvatureShortcut(event, true)).toBe(true)
		expect(isCurvatureShortcut({ ...event, ctrlKey: true }, true)).toBe(false)
		expect(
			isCurvatureShortcut({ ...event, ctrlKey: true, metaKey: false }, false),
		).toBe(true)
		expect(isCurvatureShortcut({ ...event, shiftKey: false }, true)).toBe(false)
	})

	it("exposes a compact keyboard-operable model and its disabled reason", () => {
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		const onEnabledChange = vi.fn()
		const onSizeChange = vi.fn()
		const onIntensityChange = vi.fn()
		const onSideChange = vi.fn()
		const props = {
			enabled: false,
			disabledReason: "Select a vector object.",
			size: 1,
			intensity: 0.7,
			side: "outside" as const,
			onEnabledChange,
			onSizeChange,
			onIntensityChange,
			onSideChange,
		}
		render(h(CurvatureCombControls, props), host)
		const toggle = host.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		)!
		expect(toggle.disabled).toBe(true)
		expect(host.textContent).toContain("Select a vector object.")

		render(
			h(CurvatureCombControls, {
				...props,
				enabled: true,
				disabledReason: null,
			}),
			host,
		)
		const size = host.querySelector<HTMLInputElement>(
			'input[aria-label="Size"]',
		)!
		act(() =>
			size.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "ArrowUp",
				}),
			),
		)
		expect(onSizeChange).toHaveBeenCalledWith(1.1)
		const direction = host.querySelector<HTMLSelectElement>("select")!
		act(() => {
			direction.value = "signed"
			direction.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(onSideChange).toHaveBeenCalledWith("signed")
	})

	it("uses a wrapping-safe two-column compact layout", async () => {
		const packageRoot = process.cwd().endsWith("packages/create-art/editor")
			? process.cwd()
			: join(process.cwd(), "packages/create-art/editor")
		const css = await readFile(
			join(packageRoot, "src/CurvatureCombControls.module.css"),
			"utf8",
		)
		expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))")
		expect(css).toContain("min-width: 0")
	})
})
