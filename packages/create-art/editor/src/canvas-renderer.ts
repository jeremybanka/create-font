import "konva/lib/shapes/Circle.js"
import "konva/lib/shapes/Line.js"
import "konva/lib/shapes/Path.js"
import "konva/lib/shapes/Rect.js"
import "konva/lib/shapes/Text.js"

import type Konva from "konva"
import { createElement, forwardRef } from "react"
import {
	Stage as ReactKonvaStage,
	type StageProps,
} from "react-konva/lib/ReactKonvaCore.js"

export {
	Circle,
	Group,
	Layer,
	Line,
	Path,
	Rect,
	Text,
} from "react-konva/lib/ReactKonvaCore.js"
export type { KonvaEventObject } from "konva/lib/Node"

/** Keeps the full-size host behavior of the former local renderer. */
export const Stage = forwardRef<Konva.Stage, StageProps>(
	({ style, ...props }, ref) =>
		createElement(ReactKonvaStage, {
			...props,
			ref,
			style: { display: "block", height: "100%", width: "100%", ...style },
		}),
)
Stage.displayName = "Stage"
