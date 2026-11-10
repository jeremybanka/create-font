import { font, design } from "virtual:spa-canvas-documents"

import { mountCanvas } from "./Canvas.tsx"
import { createDesignCanvasModel, createFontCanvasModel } from "./models.ts"
import "./style.css"

const fontHost = document.querySelector<HTMLElement>("#font")!
const designHost = document.querySelector<HTMLElement>("#design")!
const roots = [
	mountCanvas(fontHost, createFontCanvasModel(font)),
	mountCanvas(designHost, createDesignCanvasModel(design)),
]

const dispose = () => {
	for (const root of roots) root.dispose()
}
window.addEventListener("pagehide", (event) => {
	if (!event.persisted) dispose()
})
import.meta.hot?.dispose(dispose)
