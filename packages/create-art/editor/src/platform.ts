interface NavigatorWithUserAgentData {
	readonly platform: string
	readonly userAgentData?: { readonly platform?: string }
}

export function isMacLike(navigatorValue: NavigatorWithUserAgentData): boolean {
	const platform = navigatorValue.userAgentData?.platform
	return /mac|iphone|ipad|ipod/i.test(platform ?? navigatorValue.platform)
}

export const IS_MAC_LIKE =
	typeof navigator === "undefined" ? false : isMacLike(navigator)
export const MOD_KEY_LABEL = IS_MAC_LIKE ? "⌘" : "ctrl"
