import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		exclude: [`tests/**/*.e2e.test.ts`],
		include: [`tests/**/*.test.ts`],
		testTimeout: 15_000,
	},
})
