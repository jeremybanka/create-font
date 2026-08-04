import type {
	DesignContour,
	DesignFontReference,
	DesignObject,
} from "@create-design/source"
import type {
	FontDiagnostic,
	FontIdentity,
	FontServiceCacheStats,
} from "@create-font/font-service"

export interface DesignTextDiagnostic {
	readonly code:
		| FontDiagnostic["code"]
		| "text.invalid-object"
		| "text.overset"
		| "text.outline-unavailable"
	readonly severity: "error" | "warning"
	readonly message: string
	readonly objectId: string
	readonly textIndex?: number
}

export interface DesignTextGlyph {
	readonly glyphId: number
	readonly cluster: number
	readonly clusterEnd: number
	readonly lineIndex: number
	readonly x: number
	readonly y: number
	readonly advanceX: number
	readonly advanceY: number
	readonly contours: readonly DesignContour[]
}

export interface DesignTextLine {
	readonly textStart: number
	readonly textEnd: number
	readonly baseline: number
	readonly advance: number
	readonly glyphStart: number
	readonly glyphEnd: number
}

export interface DesignTextBounds {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface DesignTextLayout {
	readonly objectId: string
	readonly font: FontIdentity
	readonly glyphs: readonly DesignTextGlyph[]
	readonly lines: readonly DesignTextLine[]
	readonly diagnostics: readonly DesignTextDiagnostic[]
	readonly visibleTextEnd: number
	readonly overset: boolean
	/** Logical line box for point text or the authored frame for area text. */
	readonly logicalBounds: DesignTextBounds
	/** Exact projected visible glyph ink before the object transform. */
	readonly inkBounds: DesignTextBounds | null
	/** Point logical+ink union, or the authored area-text frame. */
	readonly bounds: DesignTextBounds
}

export interface ExpandedText {
	readonly objects: readonly DesignObject[]
	readonly groupName: string
}

export interface DesignTextService {
	registerFont(
		reference: DesignFontReference,
		bytes: Uint8Array | ArrayBuffer,
	): readonly DesignTextDiagnostic[]
	unregisterFont(fontId: string): boolean
	layout(object: DesignObject): DesignTextLayout | null
	expand(object: DesignObject, identityPrefix?: string): ExpandedText | null
	cacheStats(): FontServiceCacheStats & Readonly<{ layouts: number }>
	clearCaches(): void
}
