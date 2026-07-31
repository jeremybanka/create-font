import {
	SourceValidationError,
	type CommitSourceUnitsInput,
	type CommitSourceUnitsResult,
	type JsonValue,
	type ReadSourceComparisonInput,
	type SourceChangeGroup,
	type SourceComparison,
	type SourceProjectSnapshot,
} from "@create-font/server"
import {
	createSourceVersionControl as createSharedSourceVersionControl,
	type SourceUnitChange,
	type SourceVersionControlAdapter,
	type SourceVersionControlRuntime,
} from "@create-art/source-rpc/node"
import {
	assembleEditorFontSource,
	parseSourceUnitText,
	sourceUnitKindForPath,
	type SourceDiagnostic,
} from "@create-font/source"

import { analyzeFontSourceFeatures } from "./fea-project.ts"
import { nodeRuntimeAdapter, type RuntimeAdapter } from "./runtime.ts"

function validationIssues(
	errors: readonly [SourceDiagnostic, ...SourceDiagnostic[]],
) {
	return errors.map(({ code, message, path, unitPath }) => ({
		code,
		message,
		path,
		...(unitPath === undefined ? {} : { unitPath }),
	})) as unknown as ConstructorParameters<typeof SourceValidationError>[0]
}

function recordValue(change: SourceUnitChange) {
	const value = change.after?.value ?? change.before?.value
	return typeof value === `object` && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, JsonValue>>)
		: undefined
}

const fontSourceVersionControlAdapter: SourceVersionControlAdapter = {
	groupChanges(changes): readonly SourceChangeGroup[] {
		return changes.map((change) => {
			const record = recordValue(change)
			const glyph =
				change.path.startsWith(`glyphs/`) && change.path !== `glyphs/index.json`
			return {
				change: change.change,
				id:
					typeof record?.id === `string`
						? record.id
						: glyph
							? `glyph:${change.path}`
							: `source:${change.path}`,
				kind: glyph ? `glyph` : `source`,
				label:
					glyph && typeof record?.name === `string` ? record.name : change.path,
				paths: [change.path],
			}
		})
	},
	includesPath(path) {
		return (
			sourceUnitKindForPath(path) !== null ||
			(path.startsWith(`features/`) && path.endsWith(`.fea`))
		)
	},
	parseUnit(path, text) {
		if (path.startsWith(`features/`) && path.endsWith(`.fea`)) return text
		const kind = sourceUnitKindForPath(path)
		if (kind === null) {
			throw new SourceValidationError([
				{
					code: `directory.unknown_file`,
					message: `Source unit ${JSON.stringify(path)} is not part of the create-font directory contract.`,
					path: `$`,
					unitPath: path,
				},
			])
		}
		const parsed = parseSourceUnitText(kind, text, path)
		if (!parsed.ok)
			throw new SourceValidationError(validationIssues(parsed.errors))
		return parsed.value as JsonValue
	},
	validateSnapshot(values) {
		const assembled = assembleEditorFontSource(values)
		if (!assembled.ok)
			throw new SourceValidationError(validationIssues(assembled.errors))
		const featureAnalysis = analyzeFontSourceFeatures(values, assembled.value)
		if (!featureAnalysis.ok) {
			throw new SourceValidationError(
				featureAnalysis.diagnostics
					.filter((diagnostic) => diagnostic.severity === `error`)
					.map((diagnostic) => ({
						code: diagnostic.code,
						message: diagnostic.message,
						path: `$:${diagnostic.range.line}:${diagnostic.range.column}`,
						unitPath: diagnostic.path,
					})) as unknown as ConstructorParameters<
					typeof SourceValidationError
				>[0],
			)
		}
	},
}

export function createSourceVersionControl(
	projectRoot: string,
	readWorkingSnapshot: () => Promise<SourceProjectSnapshot>,
	runtime: RuntimeAdapter = nodeRuntimeAdapter,
): Readonly<{
	commitUnits(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
	readComparison(input: ReadSourceComparisonInput): Promise<SourceComparison>
}> {
	return createSharedSourceVersionControl(
		projectRoot,
		readWorkingSnapshot,
		fontSourceVersionControlAdapter,
		runtime as SourceVersionControlRuntime,
	) as unknown as {
		commitUnits(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
		readComparison(input: ReadSourceComparisonInput): Promise<SourceComparison>
	}
}
