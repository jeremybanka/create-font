import spa from "@atom.io/spa/vite"
import { defineConfig, type Plugin } from "vite-plus"

import { readPrototypeDocuments } from "./documents.ts"

const documentsId = "virtual:spa-canvas-documents"

function documents(): Plugin {
	return {
		name: "spa-canvas-documents",
		resolveId: (id) => (id === documentsId ? `\0${documentsId}` : undefined),
		async load(id) {
			if (id !== `\0${documentsId}`) return
			const { font, design, paths } = await readPrototypeDocuments()
			for (const path of paths) this.addWatchFile(path)
			return `export const font = ${JSON.stringify(font)};\nexport const design = ${JSON.stringify(design)};`
		},
	}
}

export default defineConfig({
	plugins: [spa(), documents()],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	build: { sourcemap: true },
	test: { include: ["tests/**/*.test.{ts,tsx}"] },
})
