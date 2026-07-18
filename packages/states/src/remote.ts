import { type Loadable, Silo } from "atom.io"
import type {
	SourceManifest,
	SourceUnitPath,
	SourceUnitSnapshot,
	CreateFontSourceService,
	WriteSourceUnitInput,
	WriteSourceUnitsInput,
	WriteSourceUnitsResult,
} from "@create-font/server"
import type { CreateFontRpcClient } from "@create-font/server/client"

export type FontSourceRemoteClient = Pick<
	CreateFontSourceService,
	"readManifest" | "readSnapshot" | "readUnit" | "writeUnit" | "writeUnits"
>

export class CreateFontRpcRequestError extends Error {
	readonly status: number

	constructor(operation: string, status: number) {
		super(`create-font RPC ${operation} failed with HTTP ${status}.`)
		this.name = `CreateFontRpcRequestError`
		this.status = status
	}
}

/** Adapt the generated Eden client to the source service used by atom.io. */
export function createEdenFontSourceClient(
	client: CreateFontRpcClient,
): FontSourceRemoteClient {
	return {
		async readSnapshot() {
			const result = await client.api.source.snapshot.get()
			if (result.error !== null || result.data === null) {
				throw new CreateFontRpcRequestError(
					`readSnapshot`,
					result.error?.status ?? 500,
				)
			}
			if (`code` in result.data) {
				throw new CreateFontRpcRequestError(`readSnapshot`, 501)
			}
			return result.data
		},
		async readManifest() {
			const result = await client.api.source.get()
			if (result.error !== null || result.data === null) {
				throw new CreateFontRpcRequestError(
					`readManifest`,
					result.error?.status ?? 500,
				)
			}
			if (`code` in result.data) {
				throw new CreateFontRpcRequestError(`readManifest`, 501)
			}
			return result.data
		},
		async readUnit(path) {
			const result = await client.api.source.unit.get({
				query: { path },
			})
			if (result.error !== null || result.data === null) {
				throw new CreateFontRpcRequestError(
					`readUnit`,
					result.error?.status ?? 500,
				)
			}
			if (`code` in result.data) {
				throw new CreateFontRpcRequestError(`readUnit`, 501)
			}
			return result.data
		},
		async writeUnit(input) {
			const result = await client.api.source.unit.put(input)
			if (result.error !== null || result.data === null) {
				throw new CreateFontRpcRequestError(
					`writeUnit`,
					result.error?.status ?? 500,
				)
			}
			if (`code` in result.data) {
				throw new CreateFontRpcRequestError(`writeUnit`, 501)
			}
			return result.data
		},
		async writeUnits(input) {
			const result = await client.api.source.units.put({
				...input,
				writes: [...input.writes],
			})
			if (result.error !== null || result.data === null) {
				throw new CreateFontRpcRequestError(
					`writeUnits`,
					result.error?.status ?? 500,
				)
			}
			if (`code` in result.data) {
				throw new CreateFontRpcRequestError(`writeUnits`, 500)
			}
			return result.data
		},
	}
}

export type CreateRemoteFontSourceStateOptions = Readonly<{
	client: FontSourceRemoteClient
	/**
	 * Decode and transactionally install one server snapshot into the hot editor
	 * graph. A glyph hydrator must clear only that glyph's timeline after setting
	 * the baseline.
	 */
	hydrate?: (
		snapshot: SourceUnitSnapshot,
		context: RemoteSourceHydrationContext,
	) => Promise<void> | void
	isProduction?: boolean
	key: string
}>

export type RemoteSourceHydrationContext = Readonly<{
	reason: `read` | `write`
}>

export type RemoteLoadable<Value> = Error | Loadable<Value>

/**
 * A per-file RPC query cache outside the editor's undo timeline scope.
 * Read is hydration, the source-unit path is identity, and reset is explicit
 * invalidation.
 */
export function createRemoteFontSourceState(
	options: CreateRemoteFontSourceStateOptions,
) {
	if (options.key.trim().length === 0) {
		throw new TypeError(`A remote font source Silo name cannot be empty.`)
	}

	const silo = new Silo({
		name: options.key,
		lifespan: `ephemeral`,
		isProduction: options.isProduction ?? false,
	})
	const manifestAtom = silo.atom<Loadable<SourceManifest>, Error>({
		key: `manifest`,
		default: () => options.client.readManifest(),
		catch: [Error],
	})
	const unitAtoms = silo.atomFamily<
		Loadable<SourceUnitSnapshot>,
		SourceUnitPath,
		Error
	>({
		key: `unit`,
		default: async (path) => {
			const snapshot = await options.client.readUnit(path)
			await options.hydrate?.(snapshot, { reason: `read` })
			return snapshot
		},
		catch: [Error],
	})

	return {
		silo,
		atoms: {
			manifest: manifestAtom,
			unit: unitAtoms,
		},
		read: {
			manifest: (): RemoteLoadable<SourceManifest> =>
				silo.getState(manifestAtom),
			unit: (path: SourceUnitPath): RemoteLoadable<SourceUnitSnapshot> =>
				silo.getState(unitAtoms, path),
		},
		actions: {
			refreshManifest(): void {
				silo.resetState(manifestAtom)
			},
			refreshUnit(path: SourceUnitPath): void {
				silo.resetState(unitAtoms, path)
			},
			async writeUnit(
				input: WriteSourceUnitInput,
			): Promise<SourceUnitSnapshot> {
				const snapshot = await options.client.writeUnit(input)
				await options.hydrate?.(snapshot, { reason: `write` })
				silo.setState(unitAtoms, input.path, snapshot)
				silo.resetState(manifestAtom)
				return snapshot
			},
			async writeUnits(
				input: WriteSourceUnitsInput,
			): Promise<WriteSourceUnitsResult> {
				const result = await options.client.writeUnits(input)
				for (const snapshot of result.units) {
					await options.hydrate?.(snapshot, { reason: `write` })
					silo.setState(unitAtoms, snapshot.path, snapshot)
				}
				silo.resetState(manifestAtom)
				return result
			},
		},
	}
}
