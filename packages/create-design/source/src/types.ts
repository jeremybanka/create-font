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

export type DesignFillRule = "nonzero" | "evenodd"

/** A durable reference into the source project's `fonts/index.json`. */
export interface DesignFontReference {
	readonly id: string
	readonly family: string
	readonly faceIndex?: number
	readonly revision?: string | number
}

export interface DesignTextTypography {
	readonly font: DesignFontReference
	/** Type size in document units. */
	readonly size: number
	/** Baseline-to-baseline distance in document units. */
	readonly leading: number
	/** Additional advance per grapheme in em/1000 units. */
	readonly tracking: number
	/** `auto` enables the font's kern feature; a number is an em/1000 override. */
	readonly kerning: "auto" | number
	readonly alignment: "start" | "center" | "end" | "justify"
	readonly direction: "auto" | "ltr" | "rtl" | "ttb" | "btt"
	readonly language?: string
	readonly script?: string
	readonly variations?: Readonly<Record<string, number>>
}

export type DesignTextGeometry = Readonly<{
	readonly kind: "text"
	readonly mode: "point" | "area"
	/** Canonical UTF-16 source. It is never replaced by shaped output. */
	readonly text: string
	readonly typography: DesignTextTypography
	/** Local-space insertion point and first baseline. */
	readonly x: number
	readonly y: number
	/** Required for area text and absent for point text. */
	readonly frame?: Readonly<{
		readonly width: number
		readonly height: number
		readonly inset: Readonly<{
			readonly top: number
			readonly right: number
			readonly bottom: number
			readonly left: number
		}>
		readonly verticalAlignment: "top" | "center" | "bottom"
	}>
}>

export type DesignImageSource = Readonly<
	| {
			readonly kind: "embedded"
			/** Stable identity in the source project's `assets/index.json`. */
			readonly id: string
	  }
	| {
			readonly kind: "linked"
			/** Stable identity retained when a link is missing or is relinked. */
			readonly id: string
			readonly href: string
			readonly expectedDigest?: `sha256:${string}`
	  }
>

/** A placed raster whose local bounds are its authored intrinsic dimensions. */
export type DesignImageGeometry = Readonly<{
	readonly kind: "image"
	readonly source: DesignImageSource
	readonly mediaType: "image/jpeg" | "image/png"
	readonly intrinsicWidth: number
	readonly intrinsicHeight: number
}>

/** Runtime bytes resolved without changing the durable placed-image identity. */
export type DesignImageResource = Readonly<{
	readonly id: string
	readonly mediaType: "image/jpeg" | "image/png"
	readonly bytes: Uint8Array
}>

export type DesignGeometry =
	| DesignTextGeometry
	| DesignImageGeometry
	| Readonly<{
			readonly kind: "path"
			/** Fill containment semantics. Legacy paths without this field are even-odd. */
			readonly fillRule?: DesignFillRule
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
	readonly cap: "butt" | "round" | "square"
	readonly join: "miter" | "round" | "bevel"
	readonly miterLimit: number
	readonly dashArray: readonly number[]
	readonly dashOffset: number
}

export const DEFAULT_DESIGN_STROKE_STYLE = Object.freeze({
	cap: "butt" as const,
	join: "miter" as const,
	miterLimit: 4,
	dashArray: Object.freeze([]) as readonly number[],
	dashOffset: 0,
})

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

export interface DesignBlendPointCorrespondence {
	readonly startPointId: string
	readonly endPointId: string
}

export interface DesignBlendContourCorrespondence {
	readonly startContourId: string
	readonly endContourId: string
	readonly points: readonly DesignBlendPointCorrespondence[]
}

/**
 * A non-destructive blend between two ordinary document objects.
 *
 * `steps` counts derived intermediate objects; endpoints remain ordinary
 * objects. Correspondence is persisted so point and contour array reordering
 * does not silently change a blend.
 */
export interface DesignBlend {
	readonly id: string
	readonly name: string
	readonly startObjectId: string
	readonly endObjectId: string
	readonly steps: number
	readonly contours: readonly DesignBlendContourCorrespondence[]
	readonly hidden?: boolean
	readonly locked?: boolean
}

export type DesignSceneChild = Readonly<
	| { readonly kind: "object"; readonly id: string }
	| { readonly kind: "group"; readonly id: string }
>

/** A structural container; paint and geometry remain owned by its children. */
export interface DesignGroup {
	readonly id: string
	readonly name: string
	readonly children: readonly DesignSceneChild[]
	/** A direct vector-object child used as this group's non-painting clip. */
	readonly clippingPathId?: string
}

/** A named top-level paint-order and editing boundary. */
export interface DesignLayer {
	readonly id: string
	readonly name: string
	readonly children: readonly DesignSceneChild[]
	/** Symbolic editor-only planning color; never artwork paint. */
	readonly uiColor?: DesignLayerUiColor
	readonly hidden?: boolean
	readonly locked?: boolean
}

export interface DesignGuide {
	readonly id: string
	readonly axis: "x" | "y"
	readonly value: number
	/** Locked guides remain visible snap targets but cannot be moved or deleted. */
	readonly locked?: boolean
}

export interface DesignArtboardInsets {
	readonly top: number
	readonly right: number
	readonly bottom: number
	readonly left: number
}

/**
 * One named export rectangle in the global document coordinate plane.
 *
 * Artboards never own artwork. Their order is the order of the containing
 * `DesignDocument.artboards` array.
 */
export interface DesignArtboard {
	readonly id: string
	readonly name: string
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
	/** Optional authored solid background. Absence means transparent. */
	readonly backgroundColor?: string
	/** Editor-only chrome color. Absence resolves to the neutral default. */
	readonly borderColor?: string
	readonly bleed?: DesignArtboardInsets
	readonly safeArea?: DesignArtboardInsets
}

export interface DesignDocument {
	readonly format: "create-design.document"
	readonly version: 6
	readonly title: string
	/** Ordered export rectangles, independent from the global scene hierarchy. */
	readonly artboards: readonly DesignArtboard[]
	readonly swatches: readonly DesignSwatch[]
	readonly objects: readonly DesignObject[]
	/** Live derived blends; intermediate geometry is never persisted as objects. */
	readonly blends?: readonly DesignBlend[]
	/** Ordered top-level paint and editing boundaries, back to front. */
	readonly layers: readonly DesignLayer[]
	/** Structural groups referenced by layers and other groups. */
	readonly groups: readonly DesignGroup[]
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
import type { DesignLayerUiColor } from "./layer-ui-color.ts"
