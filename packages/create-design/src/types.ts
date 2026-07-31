export type {
	CmykColor,
	ColorDefinition,
	DesignAppearance,
	DesignArtboard,
	DesignArtboardInsets,
	DesignContour,
	DesignDocument,
	DesignFill,
	DesignGeometry,
	DesignGuide,
	DesignObject,
	DesignPoint,
	DesignStroke,
	DesignSwatch,
	DesignTransform,
	RgbColor,
} from "@create-design/source"

export type DesignTool =
	| "select"
	| "direct"
	| "transform"
	| "pen"
	| "rect"
	| "ellipse"
