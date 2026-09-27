import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		fileParallelism: false,
		include: [`tests/**/*.e2e.test.ts`],
		testTimeout: 30_000,
	},
})
