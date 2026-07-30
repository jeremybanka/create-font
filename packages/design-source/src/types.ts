export type RgbColor = Readonly<{
	readonly space: "rgb"
	readonly r: number
	readonly g: number
	readonly b: number
}>

export type CmykColor = Readonly<{
	readonly space: "cmyk"
	readonly c: number
	readonly m: number
	readonly y: number
	readonly k: number
}>

export type ColorDefinition = RgbColor | CmykColor

export interface DesignSwatch {
	readonly id: string
	readonly name: string
	readonly source: ColorDefinition
	/** An optional manually tuned definition in the other color space. */
	readonly alternate?: ColorDefinition | undefined
}

export interface DesignPoint {
	readonly x: number
	readonly y: number
	readonly incoming?: Readonly<{ readonly x: number; readonly y: number }>
	readonly outgoing?: Readonly<{ readonly x: number; readonly y: number }>
}

export interface DesignContour {
	readonly closed: boolean
	readonly points: readonly DesignPoint[]
}

export interface DesignObject {
	readonly id: string
	readonly name: string
	readonly contours: readonly DesignContour[]
	readonly fillId: string
	readonly hidden?: boolean
	readonly locked?: boolean
}

export interface DesignGuide {
	readonly id: string
	readonly axis: "x" | "y"
	readonly value: number
}

export interface DesignDocument {
	readonly format: "create-design.document"
	readonly version: 1
	readonly title: string
	readonly page: Readonly<{
		readonly width: number
		readonly height: number
	}>
	readonly swatches: readonly DesignSwatch[]
	readonly objects: readonly DesignObject[]
	readonly guides: readonly DesignGuide[]
}

export type DesignSourceDiagnosticCode =
	| "directory.duplicate_id"
	| "directory.duplicate_path"
	| "directory.entity_id"
	| "directory.hierarchy"
	| "directory.missing_file"
	| "directory.orphan_file"
	| "directory.reference"
	| "directory.unsupported"
	| "directory.unsafe_path"
	| "directory.unknown_file"
	| "json.syntax"
	| "source.schema"

export interface DesignSourceDiagnostic {
	readonly severity: "error"
	readonly code: DesignSourceDiagnosticCode
	readonly unitPath?: string
	readonly path: string
	readonly message: string
}

export interface DesignSourceSuccess<Value> {
	readonly ok: true
	readonly value: Value
}

export interface DesignSourceFailure {
	readonly ok: false
	readonly errors: readonly [
		DesignSourceDiagnostic,
		...DesignSourceDiagnostic[],
	]
}

export type DesignSourceResult<Value> =
	| DesignSourceSuccess<Value>
	| DesignSourceFailure
