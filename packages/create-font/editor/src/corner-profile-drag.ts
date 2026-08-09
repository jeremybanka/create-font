import type { PointId } from "@create-font/states"

export type FontCornerProfileSetting = Readonly<{
	profile: "circular" | "squircle"
	amount: number
}>

export function offsetCornerProfileSettings(
	settings: ReadonlyMap<PointId, FontCornerProfileSetting>,
	delta: number,
): ReadonlyMap<PointId, FontCornerProfileSetting> {
	return new Map(
		[...settings].map(
			([pointId, setting]) =>
				[
					pointId,
					{ ...setting, amount: Math.max(0, setting.amount + delta) },
				] as const,
		),
	)
}
