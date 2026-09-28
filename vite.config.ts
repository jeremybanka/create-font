import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	staged: {
		"*": ["pnpm run fmt -- --allow-no-files", "vp check --no-fmt --fix"],
	},
})
