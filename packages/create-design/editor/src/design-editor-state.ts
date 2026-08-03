import { Silo } from "atom.io"

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

	const documentAtom = silo.atom<DesignDocument>({
		key: "document",
		default: options.document,
	})
	const persistenceAtom = silo.atom<DesignPersistenceState>({
		key: "persistence",
		default: options.persistence,
	})
	const snapshotSelector = silo.selector<DesignEditorSnapshot>({
		key: "snapshot",
		get: ({ get }) => ({
			document: get(documentAtom),
			persistence: get(persistenceAtom),
		}),
	})

	const documentTimeline = silo.timeline({
		key: "document",
		scope: [documentAtom],
	})

	const commitDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "commitDocument",
		do: ({ get, set }, document) => {
			if (document !== get(documentAtom)) set(documentAtom, document)
		},
	})
	const resetDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "resetDocument",
		do: ({ set }, document) => {
			set(documentAtom, document)
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
			set(documentAtom, update.document)
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
			set(documentAtom, document)
			set(
				persistenceAtom,
				reduceDesignPersistence(get(persistenceAtom), {
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

	return {
		silo,
		states: {
			documentAtom,
			persistenceAtom,
			snapshotSelector,
		},
		timelines: { documentTimeline },
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
				silo.clearTimeline(documentTimeline)
			},
			updatePersistence: runUpdatePersistence,
			loadExternalDocument(update: DesignExternalDocument): void {
				runLoadExternalDocument(update)
				silo.clearTimeline(documentTimeline)
			},
			recoverDocument(document: DesignDocument): void {
				runRecoverDocument(document)
				silo.clearTimeline(documentTimeline)
			},
		},
	}
}

export type DesignEditorState = ReturnType<typeof createDesignEditorState>
