import {
	createFontEditorState,
	type EditorFontSource,
} from "@create-font/states"

export type FontValidationStatus = Readonly<{
	ok: boolean
	issueCount: number
}>

const validationState = createFontEditorState({
	key: `create-font/source-validation`,
	isProduction: true,
})

export function compileFontValidation(
	source: EditorFontSource,
): FontValidationStatus {
	validationState.actions.load(source)
	const compilation = validationState.read.compilation()
	const issueCount = compilation.ok
		? compilation.projectionWarnings.length +
			compilation.ingestionWarnings.length
		: compilation.stage === `projection-failed`
			? compilation.projectionErrors.length +
				compilation.projectionWarnings.length
			: compilation.projectionWarnings.length +
				compilation.ingestionErrors.length +
				compilation.ingestionWarnings.length
	return { ok: compilation.ok, issueCount }
}
