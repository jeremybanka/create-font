export type SpriteAppearance = "system" | "light" | "dark"

export const SPRITE_APPEARANCE_STORAGE_KEY = "create-sprites:appearance:v1"

export function normalizeSpriteAppearance(
	value: unknown,
): SpriteAppearance | null {
	return value === "system" || value === "light" || value === "dark"
		? value
		: null
}

export function readSpriteAppearance(
	storage: Pick<Storage, "getItem"> | undefined,
): SpriteAppearance {
	if (storage === undefined) return "system"
	try {
		return (
			normalizeSpriteAppearance(
				storage.getItem(SPRITE_APPEARANCE_STORAGE_KEY),
			) ?? "system"
		)
	} catch {
		return "system"
	}
}

export function spriteAppearanceIsLight(
	appearance: SpriteAppearance,
	systemPrefersLight: boolean,
): boolean {
	return (
		appearance === "light" || (appearance === "system" && systemPrefersLight)
	)
}
