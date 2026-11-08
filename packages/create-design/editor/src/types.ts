export type {
	ColorDefinition,
	DesignAppearance,
	DesignArtboard,
	DesignArtboardInsets,
	DesignBlend,
	DesignContour,
	DesignDocument,
	DesignFillRule,
	DesignFontReference,
	DesignGeometry,
	DesignGuide,
	DesignGroup,
	DesignImageResource,
	DesignImageSource,
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
} from "@create-design/source"

export type DesignTool =
	| "select"
	| "direct"
	| "transform"
	| "perspective"
	| "artboard"
	| "pen"
	| "knife"
	| "rect"
	| "ellipse"
	| "text"
	| "area-text"
	| "guide"
