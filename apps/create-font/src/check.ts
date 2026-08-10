import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { SourceValidationError } from "@create-font/server"
import type { FeaAnalysisDiagnostic, FeaSourceRange } from "@create-font/source"

import { analyzeFontProjectFeatures } from "./fea-project.ts"
import { loadEditorFontSourceDirectory } from "./source-service.ts"

export type FontCheckDiagnostic = FeaAnalysisDiagnostic

export interface FontCheckResult {
	readonly diagnostics: readonly FontCheckDiagnostic[]
	readonly ok: boolean
	readonly root: string
}

const rootRange: FeaSourceRange = {
	column: 1,
	end: 0,
	line: 1,
	start: 0,
}

function rangeFromIssuePath(path: string): FeaSourceRange {
	const match = /:(\d+):(\d+)$/u.exec(path)
	if (!match) return rootRange
	const line = Number(match[1])
	const column = Number(match[2])
	return { column, end: 0, line, start: 0 }
}

function compareDiagnostics(
	left: FontCheckDiagnostic,
	right: FontCheckDiagnostic,
): number {
	return (
		left.path.localeCompare(right.path) ||
		left.range.line - right.range.line ||
		left.range.column - right.range.column ||
		left.code.localeCompare(right.code)
	)
}

export async function checkFontProject(
	rootInput: string,
): Promise<FontCheckResult> {
	const root = resolve(rootInput)
	try {
		const source = await loadEditorFontSourceDirectory(root)
		const analysis = await analyzeFontProjectFeatures(root, source)
		return {
			diagnostics: analysis.diagnostics,
			ok: analysis.ok,
			root,
		}
	} catch (error) {
		if (error instanceof SourceValidationError) {
			const diagnostics = error.issues
				.map((issue): FontCheckDiagnostic => ({
					code: issue.code,
					message: issue.message,
					path: issue.unitPath ?? issue.path,
					range: rangeFromIssuePath(issue.path),
					severity: "error",
				}))
				.toSorted(compareDiagnostics)
			return { diagnostics, ok: false, root }
		}
		return {
			diagnostics: [
				{
					code: "check.failed",
					message: error instanceof Error ? error.message : String(error),
					path: root,
					range: rootRange,
					severity: "error",
				},
			],
			ok: false,
			root,
		}
	}
}

function colorsEnabled(): boolean {
	if (`NO_COLOR` in process.env) return false
	if (process.env.FORCE_COLOR === `0`) return false
	if (process.env.FORCE_COLOR) return true
	return process.stderr.isTTY === true
}

function paint(value: string, code: number, enabled: boolean): string {
	return enabled ? `\u001B[${code}m${value}\u001B[0m` : value
}

export async function formatStylishCheck(
	result: FontCheckResult,
): Promise<string> {
	if (result.diagnostics.length === 0) return `No feature diagnostics found.`
	const color = colorsEnabled()
	const blocks: string[] = []
	for (const diagnostic of result.diagnostics) {
		const absolute = resolve(result.root, diagnostic.path)
		const source = await readFile(absolute, `utf8`).catch(() => ``)
		const lines = source.split(/\r?\n/u)
		const line = lines[diagnostic.range.line - 1]
		const location = `${diagnostic.path}:${diagnostic.range.line}:${diagnostic.range.column}`
		const severityColor = diagnostic.severity === `error` ? 31 : 33
		const header = `${paint(location, 36, color)}  ${paint(diagnostic.severity, severityColor, color)} ${diagnostic.code}`
		if (line === undefined || line.length === 0) {
			blocks.push(`${header}\n  ${diagnostic.message}`)
			continue
		}
		const lineNumber = String(diagnostic.range.line)
		const gutter = ` ${lineNumber} │ `
		const marker = `${` `.repeat(gutter.length + diagnostic.range.column - 1)}^`
		blocks.push(
			`${header}\n${gutter}${line}\n${paint(marker, severityColor, color)} ${diagnostic.message}`,
		)
	}
	const errors = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === `error`,
	).length
	const warnings = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === `warning`,
	).length
	blocks.push(
		`${errors} error${errors === 1 ? `` : `s`}, ${warnings} warning${warnings === 1 ? `` : `s`}`,
	)
	return blocks.join(`\n\n`)
}
