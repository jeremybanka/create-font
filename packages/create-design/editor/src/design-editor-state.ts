import { Silo, type TimelineEffect } from "atom.io"

import {
	reduceDesignPersistence,
	type DesignPersistenceAction,
	type DesignPersistenceState,
} from "./persistence.ts"
import { createDesignDocumentState } from "./design-document-state.ts"
import type { DesignDocument } from "./types.ts"

export const DESIGN_HISTORY_UNDO_LIMIT = 100

const retainLatestDesignUndoSteps: TimelineEffect = ({
	cullUndoSteps,
	onRecord,
}) => {
	onRecord(() => {
		cullUndoSteps(DESIGN_HISTORY_UNDO_LIMIT)
	})
}

export type CreateDesignEditorStateOptions = Readonly<{
	document: DesignDocument
	persistence: DesignPersistenceState
	name?: string
}>

export type DesignExternalDocument = Readonly<{
	document: DesignDocument
	durableRevision: string
}>

/**
 * The canonical, independently-instantiable state graph for one design editor.
 * Browser gesture and viewport state deliberately remain component-local.
 */
export function createDesignEditorState(
	options: CreateDesignEditorStateOptions,
) {
	const silo = new Silo({
		name: options.name ?? "create-design-editor",
		lifespan: "ephemeral",
		isProduction: process.env.NODE_ENV === "production",
	})

	const document = createDesignDocumentState(silo, options.document)
	const documentTimeline = silo.timeline({
		key: "document",
		scope: document.scope,
		effects: [retainLatestDesignUndoSteps],
	})
	const persistenceAtom = silo.atom<DesignPersistenceState>({
		key: "persistence",
		default: options.persistence,
	})
	const commitDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "commitDocument",
		do: (tools, nextDocument) => {
			document.writeDocument(tools, nextDocument)
		},
	})
	const resetDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "resetDocument",
		do: (tools, nextDocument) => {
			document.writeDocument(tools, nextDocument)
		},
	})
	const updatePersistenceTransaction = silo.transaction<
		(action: DesignPersistenceAction) => void
	>({
		key: "updatePersistence",
		do: ({ get, set }, action) => {
			const current = get(persistenceAtom)
			const next = reduceDesignPersistence(current, action)
			if (next !== current) set(persistenceAtom, next)
		},
	})
	const loadExternalDocumentTransaction = silo.transaction<
		(update: DesignExternalDocument) => void
	>({
		key: "loadExternalDocument",
		do: (tools, update) => {
			document.writeDocument(tools, update.document)
			tools.set(
				persistenceAtom,
				reduceDesignPersistence(tools.get(persistenceAtom), {
					type: "external-loaded",
					durableRevision: update.durableRevision,
				}),
			)
		},
	})
	const recoverDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "recoverDocument",
		do: (tools, nextDocument) => {
			document.writeDocument(tools, nextDocument)
			tools.set(
				persistenceAtom,
				reduceDesignPersistence(tools.get(persistenceAtom), {
					type: "recover-draft",
				}),
			)
		},
	})

	const runCommitDocument = silo.runTransaction(commitDocumentTransaction)
	const runResetDocument = silo.runTransaction(resetDocumentTransaction)
	const runUpdatePersistence = silo.runTransaction(updatePersistenceTransaction)
	const runLoadExternalDocument = silo.runTransaction(
		loadExternalDocumentTransaction,
	)
	const runRecoverDocument = silo.runTransaction(recoverDocumentTransaction)
	const rebaseDocumentHistory = (): void => {
		silo.clearTimeline(documentTimeline)
	}

	return {
		silo,
		documentTimeline,
		states: {
			...document.states,
			persistenceAtom,
		},
		transactions: {
			commitDocumentTransaction,
			resetDocumentTransaction,
			updatePersistenceTransaction,
			loadExternalDocumentTransaction,
			recoverDocumentTransaction,
		},
		actions: {
			commitDocument: runCommitDocument,
			resetDocument(document: DesignDocument): void {
				runResetDocument(document)
				rebaseDocumentHistory()
			},
			updatePersistence: runUpdatePersistence,
			loadExternalDocument(update: DesignExternalDocument): void {
				runLoadExternalDocument(update)
				rebaseDocumentHistory()
			},
			recoverDocument(document: DesignDocument): void {
				runRecoverDocument(document)
				rebaseDocumentHistory()
			},
		},
	}
}

export type DesignEditorState = ReturnType<typeof createDesignEditorState>
