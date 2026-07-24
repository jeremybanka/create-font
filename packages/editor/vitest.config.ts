import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		coverage: {
			clean: true,
			include: [
				"src/GlyphCanvas.tsx",
				"src/VectorScene.tsx",
				"src/canvas-cursor.ts",
				"src/canvas-foundations.ts",
				"src/canvas-group-drag.ts",
				"src/canvas-hit-testing.ts",
				"src/canvas-snapping.ts",
				"src/curve-editing.ts",
				"src/editor-tools-and-hotkeys.ts",
				"src/geometry.ts",
				"src/outline-selection.ts",
				"src/pen-gesture.ts",
				"src/rule-clipboard.ts",
				"src/rule-geometry.ts",
				"src/select-editing.ts",
				"src/shape-gesture.ts",
				"src/topology-tools.ts",
				"src/transform-gesture.ts",
				"src/vector-editing.ts",
				"src/vector-gesture.ts",
				"src/vector-scene.ts",
			],
			provider: "v8",
			reportOnFailure: true,
			reporter: ["text", "text-summary", "json", "json-summary", "html"],
			reportsDirectory: "./coverage",
			thresholds: {
				branches: 63,
				functions: 74,
				lines: 72,
				statements: 69,
			},
		},
	},
})
