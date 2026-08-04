export type {
	CmykColor,
	ColorDefinition,
	DesignAppearance,
	DesignArtboard,
	DesignArtboardInsets,
	DesignBlend,
	DesignBlendContourCorrespondence,
	DesignBlendPointCorrespondence,
	DesignContour,
	DesignDocument,
	DesignFill,
	DesignFillRule,
	DesignGeometry,
	DesignGuide,
	DesignGroup,
	DesignObject,
	DesignPoint,
	DesignStroke,
	DesignSceneChild,
	DesignSwatch,
	DesignTransform,
	RgbColor,
} from "@create-design/source"

export type DesignTool =
	| "select"
	| "direct"
	| "transform"
	| "artboard"
	| "pen"
	| "rect"
	| "ellipse"
