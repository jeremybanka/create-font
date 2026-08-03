import { describe, expect, it, vi } from "vitest"

import { masterPaletteCommands } from "../src/master-commands.ts"

describe("master commands", () => {
	it("exposes accessible previous and next actions to shared command surfaces", () => {
		const onPrevious = vi.fn()
		const onNext = vi.fn()
		const commands = masterPaletteCommands(3, onPrevious, onNext)

		expect(commands).toMatchObject([
			{
				id: "previous-master",
				displayName: "Previous master",
				category: "Masters",
				description: "Select the previous master, wrapping to the last master.",
				icon: "DoubleArrowLeftIcon",
				disabled: false,
			},
			{
				id: "next-master",
				displayName: "Next master",
				category: "Masters",
				description: "Select the next master, wrapping to the first master.",
				icon: "DoubleArrowRightIcon",
				disabled: false,
			},
		])
		expect(commands[0]?.keywords).toContain("rotate")
		expect(commands[1]?.keywords).toContain("cycle")

		commands[0]?.do()
		commands[1]?.do()
		expect(onPrevious).toHaveBeenCalledOnce()
		expect(onNext).toHaveBeenCalledOnce()
	})

	it("disables both actions with an actionable reason for one master", () => {
		const commands = masterPaletteCommands(1, vi.fn(), vi.fn())

		for (const command of commands) {
			expect(command.disabled).toBe(true)
			expect(command.disabledReason).toBe(
				"Add another master to cycle between masters.",
			)
		}
	})
})
