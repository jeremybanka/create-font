export type BootstrapState =
	| Readonly<{ type: `loading` }>
	| Readonly<{ type: `error`; message: string }>

export type BootstrapStateEvent =
	| Readonly<{ type: `retry` }>
	| Readonly<{ type: `fail`; message: string }>

export const INITIAL_BOOTSTRAP_STATE: BootstrapState = Object.freeze({
	type: `loading`,
})

export function nextBootstrapState(
	state: BootstrapState,
	event: BootstrapStateEvent,
): BootstrapState {
	if (event.type === `retry`) return INITIAL_BOOTSTRAP_STATE
	const message = event.message.trim()
	return Object.freeze({
		type: `error`,
		message:
			message.length === 0
				? `The font source could not be opened.`
				: message,
	})
}

export function bootstrapDocumentTitle(state: BootstrapState): string {
	return state.type === `loading`
		? `Loading font source — create-font`
		: `Unable to open font — create-font`
}
