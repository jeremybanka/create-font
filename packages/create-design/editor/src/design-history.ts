import type { DesignDocument } from "./types.ts"

export interface DesignHistory {
	readonly past: readonly DesignDocument[]
	readonly present: DesignDocument
	readonly future: readonly DesignDocument[]
}

export type DesignHistoryAction =
	| { readonly type: "commit"; readonly document: DesignDocument }
	| { readonly type: "reset"; readonly document: DesignDocument }
	| { readonly type: "undo" }
	| { readonly type: "redo" }

export function createDesignHistory(document: DesignDocument): DesignHistory {
	return { past: [], present: document, future: [] }
}

export function reduceDesignHistory(
	history: DesignHistory,
	action: DesignHistoryAction,
): DesignHistory {
	if (action.type === "reset") return createDesignHistory(action.document)
	if (action.type === "undo") {
		const previous = history.past.at(-1)
		return previous === undefined
			? history
			: {
					past: history.past.slice(0, -1),
					present: previous,
					future: [history.present, ...history.future],
				}
	}
	if (action.type === "redo") {
		const next = history.future[0]
		return next === undefined
			? history
			: {
					past: [...history.past, history.present],
					present: next,
					future: history.future.slice(1),
				}
	}
	if (action.document === history.present) return history
	return {
		past: [...history.past.slice(-99), history.present],
		present: action.document,
		future: [],
	}
}
