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
	/** Stable identity for this authored path control. */
	readonly id: string
	readonly x: number
	readonly y: number
	readonly incoming?: Readonly<{ readonly x: number; readonly y: number }>
	readonly outgoing?: Readonly<{ readonly x: number; readonly y: number }>
}

export interface DesignContour {
	/** Stable identity for this authored path contour. */
	readonly id: string
	readonly closed: boolean
	readonly points: readonly DesignPoint[]
}

export type DesignGeometry =
	| Readonly<{
			readonly kind: "path"
			readonly contours: readonly DesignContour[]
	  }>
	| Readonly<{
			readonly kind: "rectangle"
			readonly x: number
			readonly y: number
			readonly width: number
			readonly height: number
	  }>
	| Readonly<{
			readonly kind: "ellipse"
			readonly centerX: number
			readonly centerY: number
			readonly radiusX: number
			readonly radiusY: number
	  }>

/**
 * An authored object's local-to-document affine transform.
 *
 * Points use `x' = a*x + c*y + e` and `y' = b*x + d*y + f`.
 */
export interface DesignTransform {
	readonly a: number
	readonly b: number
	readonly c: number
	readonly d: number
	readonly e: number
	readonly f: number
}

export interface DesignFill {
	readonly swatchId: string
}

export interface DesignStroke {
	readonly swatchId: string
	readonly width: number
}

export interface DesignAppearance {
	readonly fill?: DesignFill
	readonly stroke?: DesignStroke
}

export interface DesignObject {
	readonly id: string
	readonly name: string
	readonly geometry: DesignGeometry
	readonly transform: DesignTransform
	readonly appearance: DesignAppearance
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
	readonly version: 3
	readonly title: string
	/**
	 * The current page rectangle in the global document coordinate plane.
	 * Objects are not children of this rectangle and retain their coordinates
	 * when it moves or resizes.
	 */
	readonly page: Readonly<{
		readonly x: number
		readonly y: number
		readonly width: number
		readonly height: number
	}>
	readonly swatches: readonly DesignSwatch[]
	readonly objects: readonly DesignObject[]
	readonly guides: readonly DesignGuide[]
}

export type DesignSourceDiagnosticCode =
	| "document.format"
	| "document.future_version"
	| "document.schema"
	| "document.version"
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
