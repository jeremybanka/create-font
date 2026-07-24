import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
	},
	staged: {
		"*": ["pnpm run fmt -- --allow-no-files", "vp check --no-fmt --fix"],
	},
})
