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
	DesignFontReference,
	DesignGeometry,
	DesignGuide,
	DesignGroup,
	DesignImageGeometry,
	DesignImageResource,
	DesignImageSource,
	DesignLinkedArtboardGeometry,
	DesignLinkedArtboardResource,
	DesignLayer,
	DesignLayerUiColor,
	DesignObject,
	DesignPoint,
	DesignStroke,
	DesignTextGeometry,
	DesignTextTypography,
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
	| "text"
	| "area-text"
	| "guide"
