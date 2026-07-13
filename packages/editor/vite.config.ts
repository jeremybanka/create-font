import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

export default defineConfig({
	plugins: [preact()],
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
