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

export type DesignTool = "select" | "transform" | "pen" | "rect" | "ellipse"
