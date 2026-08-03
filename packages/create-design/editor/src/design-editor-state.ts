import { Silo } from "atom.io"

import {
	createDesignHistory,
	reduceDesignHistory,
	type DesignHistory,
} from "./design-history.ts"
import {
	reduceDesignPersistence,
	type DesignPersistenceAction,
	type DesignPersistenceState,
} from "./persistence.ts"
import type { DesignDocument } from "./types.ts"

export type CreateDesignEditorStateOptions = Readonly<{
	document: DesignDocument
	persistence: DesignPersistenceState
	name?: string
}>

export type DesignExternalDocument = Readonly<{
	document: DesignDocument
	durableRevision: string
}>

export type DesignEditorSnapshot = Readonly<{
	document: DesignDocument
	persistence: DesignPersistenceState
	history: DesignHistoryMeta
}>

export type DesignHistoryMeta = Readonly<{
	canUndo: boolean
	canRedo: boolean
	pastLength: number
	futureLength: number
}>

export type DesignHistoryDirection = "redo" | "undo"

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

	const historyAtom = silo.atom<DesignHistory>({
		key: "history",
		default: createDesignHistory(options.document),
	})
	const persistenceAtom = silo.atom<DesignPersistenceState>({
		key: "persistence",
		default: options.persistence,
	})
	const documentSelector = silo.selector<DesignDocument>({
		key: "document",
		get: ({ get }) => get(historyAtom).present,
	})
	const historyMetaSelector = silo.selector<DesignHistoryMeta>({
		key: "historyMeta",
		get: ({ get }) => {
			const history = get(historyAtom)
			return {
				canUndo: history.past.length > 0,
				canRedo: history.future.length > 0,
				pastLength: history.past.length,
				futureLength: history.future.length,
			}
		},
	})
	const snapshotSelector = silo.selector<DesignEditorSnapshot>({
		key: "snapshot",
		get: ({ get }) => ({
			document: get(documentSelector),
			persistence: get(persistenceAtom),
			history: get(historyMetaSelector),
		}),
	})

	const commitDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "commitDocument",
		do: ({ get, set }, document) => {
			const current = get(historyAtom)
			const next = reduceDesignHistory(current, { type: "commit", document })
			if (next !== current) set(historyAtom, next)
		},
	})
	const navigateDocumentHistoryTransaction = silo.transaction<
		(direction: DesignHistoryDirection) => DesignDocument | null
	>({
		key: "navigateDocumentHistory",
		do: ({ get, set }, direction) => {
			const current = get(historyAtom)
			const next = reduceDesignHistory(current, { type: direction })
			if (next === current) return null
			set(historyAtom, next)
			return next.present
		},
	})
	const resetDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "resetDocument",
		do: ({ set }, document) => {
			set(historyAtom, createDesignHistory(document))
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
		do: ({ get, set }, update) => {
			set(historyAtom, createDesignHistory(update.document))
			set(
				persistenceAtom,
				reduceDesignPersistence(get(persistenceAtom), {
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
		do: ({ get, set }, document) => {
			set(historyAtom, createDesignHistory(document))
			set(
				persistenceAtom,
				reduceDesignPersistence(get(persistenceAtom), {
					type: "recover-draft",
				}),
			)
		},
	})

	const runCommitDocument = silo.runTransaction(commitDocumentTransaction)
	const runNavigateDocumentHistory = silo.runTransaction(
		navigateDocumentHistoryTransaction,
	)
	const runResetDocument = silo.runTransaction(resetDocumentTransaction)
	const runUpdatePersistence = silo.runTransaction(updatePersistenceTransaction)
	const runLoadExternalDocument = silo.runTransaction(
		loadExternalDocumentTransaction,
	)
	const runRecoverDocument = silo.runTransaction(recoverDocumentTransaction)

	return {
		silo,
		states: {
			historyAtom,
			persistenceAtom,
			documentSelector,
			historyMetaSelector,
			snapshotSelector,
		},
		transactions: {
			commitDocumentTransaction,
			navigateDocumentHistoryTransaction,
			resetDocumentTransaction,
			updatePersistenceTransaction,
			loadExternalDocumentTransaction,
			recoverDocumentTransaction,
		},
		actions: {
			commitDocument: runCommitDocument,
			navigateDocumentHistory: runNavigateDocumentHistory,
			resetDocument(document: DesignDocument): void {
				runResetDocument(document)
			},
			updatePersistence: runUpdatePersistence,
			loadExternalDocument(update: DesignExternalDocument): void {
				runLoadExternalDocument(update)
			},
			recoverDocument(document: DesignDocument): void {
				runRecoverDocument(document)
			},
		},
	}
}

export type DesignEditorState = ReturnType<typeof createDesignEditorState>
