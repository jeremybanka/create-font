import parser from "@typescript-eslint/parser"
import atomIO from "atom.io/eslint-plugin"
import type { Linter } from "eslint"

export default [
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser,
			parserOptions: {
				ecmaVersion: "latest",
				projectService: true,
				sourceType: "module",
				tsconfigRootDir: new URL(".", import.meta.url).pathname,
			},
		},
		plugins: { "atom.io": atomIO },
		rules: {
			"atom.io/exact-catch-types": "error",
			"atom.io/explicit-state-types": "error",
			"atom.io/naming-convention": "error",
		},
	},
] satisfies Linter.Config[]
