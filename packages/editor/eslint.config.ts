import parser from "@typescript-eslint/parser"
import type { Linter } from "eslint"
import lasertag from "lasertag/eslint-plugin"

export default [
	{
		files: ["src/**/*.tsx"],
		languageOptions: {
			parser,
			parserOptions: {
				ecmaFeatures: { jsx: true },
				ecmaVersion: "latest",
				sourceType: "module",
			},
		},
		plugins: { lasertag },
		rules: {
			"lasertag/access-css-module-class-only": "error",
			"lasertag/ban-div": "error",
			"lasertag/export-own-component-only": "error",
			"lasertag/header-main-footer-as-group": "error",
			"lasertag/import-own-css-module-only": "error",
			"lasertag/name-imported-css-module-as-css": "error",
			"lasertag/render-tag-with-own-name": [
				"error",
				{ checkAllComponentFunctions: true },
			],
		},
	},
] satisfies Linter.Config[]
