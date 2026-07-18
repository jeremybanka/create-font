import type { PaletteCommand } from "./command-palette.ts"

export function selectionProportionPaletteCommand(
	enabled: boolean,
	onToggle: () => void,
): PaletteCommand {
	return {
		id: "constrain-proportions",
		displayName: "Constrain Proportions",
		category: "Selection",
		description: "Scale selection width and height together from its origin.",
		icon: "Link1Icon",
		keywords: ["link", "aspect", "ratio", "dimensions", "scale"],
		status: enabled ? "Active" : "Off",
		checked: enabled,
		do: onToggle,
	}
}
