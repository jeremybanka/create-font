export interface IllustratorSourceSpan {
	readonly start: number
	readonly end: number
	readonly line: number
	readonly column: number
}

export type IllustratorSourceColor =
	| Readonly<{ space: "gray"; value: number }>
	| Readonly<{
			space: "rgb"
			r: number
			g: number
			b: number
			alternate?: Readonly<{
				space: "cmyk"
				c: number
				m: number
				y: number
				k: number
			}>
			name?: string
			tint?: number
			colorType?: number
	  }>
	| Readonly<{
			space: "cmyk"
			c: number
			m: number
			y: number
			k: number
			name?: string
			tint?: number
			colorType?: number
			alternateGray?: number
	  }>

export interface IllustratorSourceDiagnostic {
	readonly code: string
	readonly message: string
	readonly severity: "error" | "warning" | "info"
	readonly span?: IllustratorSourceSpan
}

export interface IllustratorSourceArtboard {
	readonly uuid?: string
	readonly name: string
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
	readonly selected?: boolean
	readonly locked?: boolean
	readonly pixelAspectRatio?: number
	readonly rulerOrigin?: Readonly<{ x: number; y: number }>
	readonly bleed?: Readonly<{
		top: number
		right: number
		bottom: number
		left: number
	}>
	readonly rawProperties: Readonly<Record<string, number | string | boolean>>
	readonly span: IllustratorSourceSpan
}

export interface IllustratorSourcePoint {
	readonly x: number
	readonly y: number
	readonly mode: "hard" | "soft"
	readonly incoming?: Readonly<{ x: number; y: number }>
	readonly outgoing?: Readonly<{ x: number; y: number }>
}

export interface IllustratorSourceContour {
	readonly closed: boolean
	readonly points: readonly IllustratorSourcePoint[]
}

export interface IllustratorSourceStroke {
	readonly color: IllustratorSourceColor
	readonly width: number
	readonly cap: "butt" | "round" | "square"
	readonly join: "miter" | "round" | "bevel"
	readonly miterLimit: number
	readonly dashArray: readonly number[]
	readonly dashOffset: number
}

export interface IllustratorSourcePath {
	readonly kind: "path"
	readonly name?: string
	readonly sourceId?: string
	readonly contours: readonly IllustratorSourceContour[]
	readonly fill?: IllustratorSourceColor
	readonly stroke?: IllustratorSourceStroke
	readonly fillRule: "nonzero" | "evenodd"
	readonly locked: boolean
	readonly span: IllustratorSourceSpan
}

export interface IllustratorSourceGroup {
	readonly kind: "group"
	readonly groupKind: "normal" | "compound" | "clip"
	readonly name?: string
	readonly sourceId?: string
	readonly children: readonly IllustratorSourceNode[]
	readonly clippingPath?: IllustratorSourcePath
	readonly span: IllustratorSourceSpan
}

/** A forward-compatible operator retained even when this version cannot lower it. */
export interface IllustratorSourceUnknown {
	readonly kind: "unknown"
	readonly operator: string
	readonly operands: readonly (number | string | readonly number[])[]
	readonly span: IllustratorSourceSpan
}

export interface IllustratorTextStory {
	readonly index: number
	readonly text: string
	readonly position?: Readonly<{ x: number; y: number }>
	readonly size?: number
	readonly fontSelector?: number
	readonly raw: string
}

export interface IllustratorSourceText {
	readonly kind: "text"
	readonly storyIndex: number
	readonly frameIndex: number
	readonly freeUndo: boolean
	readonly fill?: IllustratorSourceColor
	readonly stroke?: IllustratorSourceStroke
	readonly story?: IllustratorTextStory
	readonly rawProperties: Readonly<Record<string, number>>
	readonly span: IllustratorSourceSpan
}

export interface IllustratorTextResource {
	readonly encoding: "ASCII85"
	readonly raw: string
	readonly decoded: string
	readonly stories: readonly IllustratorTextStory[]
	readonly fonts: readonly Readonly<{
		selector: number
		postScriptName: string
		raw: string
	}>[]
}

export interface IllustratorSourceStatement {
	readonly kind: "comment" | "code"
	/** Includes its original CR, LF, or CRLF terminator, when present. */
	readonly raw: string
	readonly span: IllustratorSourceSpan
}

export type IllustratorSourceNode =
	| IllustratorSourcePath
	| IllustratorSourceGroup
	| IllustratorSourceText
	| IllustratorSourceUnknown

export interface IllustratorSourceLayer {
	readonly name: string
	readonly hidden: boolean
	readonly locked: boolean
	readonly preview: boolean
	readonly printable: boolean
	readonly color?: Readonly<{ r: number; g: number; b: number }>
	readonly children: readonly IllustratorSourceNode[]
	readonly span: IllustratorSourceSpan
}

export interface IllustratorSourceStats {
	readonly layers: number
	readonly paths: number
	readonly paintedPaths: number
	readonly groups: number
	readonly textFrames: number
	readonly unknownOperators: Readonly<Record<string, number>>
}

export interface IllustratorSourceDocument {
	readonly format: "adobe-illustrator.source"
	readonly bounds?: Readonly<{
		left: number
		top: number
		right: number
		bottom: number
	}>
	readonly metadata: Readonly<{
		title?: string
		creator?: string
		creationDate?: string
		fileFormatVersion?: string
		buildVersion?: string
		colorModel?: string
		rulerUnits?: string
		pageOrigin?: Readonly<{ x: number; y: number }>
		rawHeaders: Readonly<Record<string, string>>
	}>
	readonly artboards: readonly IllustratorSourceArtboard[]
	readonly layers: readonly IllustratorSourceLayer[]
	/** Lossless source and line statements retain setup/resources and extensions. */
	readonly rawSource: string
	readonly statements: readonly IllustratorSourceStatement[]
	readonly resources: Readonly<{ text?: IllustratorTextResource }>
	readonly diagnostics: readonly IllustratorSourceDiagnostic[]
	readonly stats: IllustratorSourceStats
}
