import type { PaletteCommand } from "./command-palette.ts"

const DISABLED_REASON = "Add another master to cycle between masters."

export function masterPaletteCommands(
	masterCount: number,
	onPrevious: () => void,
	onNext: () => void,
): readonly PaletteCommand[] {
	const disabled = masterCount < 2
	return [
		{
			id: "previous-master",
			displayName: "Previous master",
			category: "Masters",
			description: "Select the previous master, wrapping to the last master.",
			icon: "DoubleArrowLeftIcon",
			keywords: ["master", "cycle", "rotate", "previous", "backward"],
			disabled,
			disabledReason: disabled ? DISABLED_REASON : undefined,
			do: onPrevious,
		},
		{
			id: "next-master",
			displayName: "Next master",
			category: "Masters",
			description: "Select the next master, wrapping to the first master.",
			icon: "DoubleArrowRightIcon",
			keywords: ["master", "cycle", "rotate", "next", "forward"],
			disabled,
			disabledReason: disabled ? DISABLED_REASON : undefined,
			do: onNext,
		},
	]
}
