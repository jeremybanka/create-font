import {
	SourceValidationError,
	SourceVersionControlError,
	type JsonValue,
	type SourceAssetService,
	type SourceChangeGroup,
	type SourceChangeKind,
	type SourceProjectSnapshot,
	type SourceService,
	type SourceVersionControlService,
} from "@create-art/source-rpc"
import {
	createSourceVersionControl,
	type SourceUnitChange,
	type SourceVersionControlAdapter,
} from "@create-art/source-rpc/node"
import {
	assembleDesignDocument,
	assetUnitPathSchema,
	designSourcePaths,
	fontUnitPathSchema,
	parseSourceUnitText,
	sourceUnitKindForPath,
	textContentUnitPathForObjectPath,
	textContentUnitPathSchema,
	validateSourceUnit,
	type AssetIndexFile,
	type DesignSourceDiagnostic,
	type DesignSourceDirectoryFiles,
	type FontIndexFile,
} from "@create-design/source"

function issues(errors: readonly DesignSourceDiagnostic[]) {
	return errors.map(({ code, message, path, unitPath }) => ({
		code,
		message,
		path,
		...(unitPath === undefined ? {} : { unitPath }),
	})) as unknown as ConstructorParameters<typeof SourceValidationError>[0]
}

function record(value: JsonValue | undefined) {
	return typeof value === `object` && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, JsonValue>>)
		: undefined
}

function aggregateChange(
	changes: readonly SourceUnitChange[],
): SourceChangeKind {
	const kinds = new Set(changes.map(({ change }) => change))
	return kinds.size === 1 ? changes[0]!.change : `modified`
}

function semanticGroup(change: SourceUnitChange): SourceChangeGroup {
	const kind = sourceUnitKindForPath(change.path) ?? `source`
	const value = record(change.after?.value ?? change.before?.value)
	const id = typeof value?.id === `string` ? value.id : undefined
	const name = typeof value?.name === `string` ? value.name : undefined
	const singleton = {
		[designSourcePaths.project]: [
			`design:project`,
			`project`,
			`Project format`,
		],
		[designSourcePaths.document]: [
			`design:document`,
			`document`,
			`Document details`,
		],
		[designSourcePaths.palette]: [`design:palette`, `palette`, `Palette`],
		[designSourcePaths.assetIndex]: [`design:assets`, `asset-index`, `Assets`],
		[designSourcePaths.fontIndex]: [`design:fonts`, `font-index`, `Fonts`],
	} as const
	const described = singleton[change.path as keyof typeof singleton]
	return {
		change: change.change,
		id: described?.[0] ?? id ?? `design:${kind}:${change.path}`,
		kind: described?.[1] ?? kind,
		label: described?.[2] ?? name ?? id ?? change.path,
		paths: [change.path],
	}
}

function indexedEntityIdentityChanged(change: SourceUnitChange): boolean {
	const kind = sourceUnitKindForPath(change.path)
	if (
		kind !== `artboard` &&
		kind !== `layer` &&
		kind !== `group` &&
		kind !== `object`
	) {
		return false
	}
	if (change.change !== `modified`) return true
	const before = record(change.before?.value)
	const after = record(change.after?.value)
	return before?.id !== after?.id
}

function isStructural(change: SourceUnitChange): boolean {
	const kind = sourceUnitKindForPath(change.path)
	return (
		kind === `artboard-index` ||
		kind === `layer-index` ||
		kind === `layer` ||
		kind === `group-index` ||
		kind === `group` ||
		kind === `object-index` ||
		indexedEntityIdentityChanged(change)
	)
}

function paletteIds(value: JsonValue | undefined): ReadonlySet<string> {
	const swatches = record(value)?.swatches
	if (!Array.isArray(swatches)) return new Set()
	return new Set(
		swatches.flatMap((swatch) => {
			const id = record(swatch)?.id
			return typeof id === `string` ? [id] : []
		}),
	)
}

function paletteDependentObjectPaths(
	changes: readonly SourceUnitChange[],
): Set<string> {
	const palette = changes.find(
		(change) => change.path === designSourcePaths.palette,
	)
	if (palette === undefined) return new Set()
	const beforeIds = paletteIds(palette.before?.value)
	const afterIds = paletteIds(palette.after?.value)
	const membershipChanged = new Set(
		[...beforeIds, ...afterIds].filter(
			(id) => beforeIds.has(id) !== afterIds.has(id),
		),
	)
	if (membershipChanged.size === 0) return new Set()
	return new Set(
		changes.flatMap((change) => {
			if (sourceUnitKindForPath(change.path) !== `object`) return []
			const beforeFill = record(change.before?.value)?.fillId
			const afterFill = record(change.after?.value)?.fillId
			return (typeof beforeFill === `string` &&
				membershipChanged.has(beforeFill)) ||
				(typeof afterFill === `string` && membershipChanged.has(afterFill))
				? [change.path]
				: []
		}),
	)
}

type BinaryDescriptor = Readonly<{
	byteLength: number
	digest: `sha256:${string}`
	id: string
	mediaType: string
	path: string
}>

function inventoryDescriptors(
	values: Readonly<Record<string, JsonValue | undefined>>,
): readonly BinaryDescriptor[] {
	const assetPath = designSourcePaths.assetIndex
	const assets = validateSourceUnit(`asset-index`, values[assetPath], assetPath)
	if (!assets.ok) throw new SourceValidationError(issues(assets.errors))
	const fontPath = designSourcePaths.fontIndex
	const fonts = validateSourceUnit(`font-index`, values[fontPath], fontPath)
	if (!fonts.ok) throw new SourceValidationError(issues(fonts.errors))
	return [
		...(assets.value as AssetIndexFile).entries,
		...(fonts.value as FontIndexFile).entries,
	].map((entry) => ({
		byteLength: entry.byteLength,
		digest: `sha256:${entry.sha256}` as const,
		id: entry.id,
		mediaType: entry.mediaType,
		path: entry.path,
	}))
}

function binaryDescriptors(
	snapshot: SourceProjectSnapshot,
): ReadonlyMap<string, BinaryDescriptor> {
	return new Map(
		inventoryDescriptors(
			Object.fromEntries(snapshot.units.map((unit) => [unit.path, unit.value])),
		).map((descriptor) => [descriptor.path, descriptor]),
	)
}

function validateBinaryComparison(
	base: SourceProjectSnapshot,
	target: SourceProjectSnapshot,
	changes: readonly SourceUnitChange[],
): void {
	const before = binaryDescriptors(base)
	const after = binaryDescriptors(target)
	for (const [label, inventory, assets] of [
		[`base`, before, base.assets ?? []],
		[`target`, after, target.assets ?? []],
	] as const) {
		const actual = new Map(assets.map((asset) => [asset.path, asset]))
		if (actual.size !== inventory.size) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`The ${label} design binary inventory does not match its binary files.`,
			)
		}
		for (const [path, expected] of inventory) {
			const descriptor = actual.get(path)
			if (
				descriptor === undefined ||
				descriptor.id !== expected.id ||
				descriptor.mediaType !== expected.mediaType ||
				descriptor.byteLength !== expected.byteLength ||
				descriptor.digest !== expected.digest
			) {
				throw new SourceVersionControlError(
					`source.repository_state`,
					`The ${label} design binary metadata does not match ${JSON.stringify(path)}.`,
				)
			}
		}
	}
	const expectedChangedPaths = new Set(
		[...new Set([...before.keys(), ...after.keys()])].filter((path) => {
			const previous = before.get(path)
			const next = after.get(path)
			return (
				previous === undefined ||
				next === undefined ||
				previous.byteLength !== next.byteLength ||
				previous.digest !== next.digest
			)
		}),
	)
	const actualChangedPaths = new Set(
		changes
			.filter(
				(change) =>
					change.assetBefore !== undefined || change.assetAfter !== undefined,
			)
			.map(({ path }) => path),
	)
	if (
		JSON.stringify([...actualChangedPaths].toSorted()) !==
		JSON.stringify([...expectedChangedPaths].toSorted())
	) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The design binary inventories and reviewed binary changes are not coherent.`,
		)
	}
}

export const designSourceVersionControlAdapter: SourceVersionControlAdapter = {
	decodeUnit(path, bytes) {
		return new TextDecoder(`utf-8`, {
			ignoreBOM: sourceUnitKindForPath(path) === `text-content`,
		}).decode(bytes)
	},
	assets: {
		descriptors(values) {
			return inventoryDescriptors(values)
		},
		isPath(path) {
			return (
				assetUnitPathSchema.safeParse(path).success ||
				fontUnitPathSchema.safeParse(path).success
			)
		},
	},
	groupChanges(changes) {
		const assetChanges = changes.filter(
			(change) =>
				change.path === designSourcePaths.assetIndex ||
				assetUnitPathSchema.safeParse(change.path).success,
		)
		const fontChanges = changes.filter(
			(change) =>
				change.path === designSourcePaths.fontIndex ||
				fontUnitPathSchema.safeParse(change.path).success,
		)
		const binaryPaths = new Set(
			[...assetChanges, ...fontChanges].map(({ path }) => path),
		)
		const structuralPaths = new Set(
			changes
				.filter((change) => !binaryPaths.has(change.path))
				.filter(isStructural)
				.map(({ path }) => path),
		)
		if (structuralPaths.size > 0) {
			for (const change of changes) {
				if (indexedEntityIdentityChanged(change)) {
					structuralPaths.add(change.path)
				}
			}
		}
		for (const change of changes) {
			if (!textContentUnitPathSchema.safeParse(change.path).success) continue
			const objectPath = `${change.path.slice(0, -".txt".length)}.json`
			if (structuralPaths.has(objectPath)) structuralPaths.add(change.path)
		}
		const palettePaths = paletteDependentObjectPaths(changes)
		if (palettePaths.size > 0) palettePaths.add(designSourcePaths.palette)
		const textChanges = new Map<string, SourceUnitChange[]>()
		for (const change of changes) {
			if (structuralPaths.has(change.path) || palettePaths.has(change.path))
				continue
			const kind = sourceUnitKindForPath(change.path)
			let objectPath: string | undefined
			if (kind === "text-content")
				objectPath = `${change.path.slice(0, -".txt".length)}.json`
			else if (kind === "object") {
				const beforeGeometry = record(change.before?.value)?.geometry
				const afterGeometry = record(change.after?.value)?.geometry
				const isText = [beforeGeometry, afterGeometry].some(
					(value) => record(value)?.kind === "text",
				)
				if (isText) objectPath = change.path
			}
			if (objectPath === undefined) continue
			const grouped = textChanges.get(objectPath) ?? []
			grouped.push(change)
			textChanges.set(objectPath, grouped)
		}
		for (const [objectPath, grouped] of textChanges) {
			const contentPath = textContentUnitPathForObjectPath(objectPath)
			const companion = changes.find(({ path }) => path === contentPath)
			if (
				companion !== undefined &&
				!grouped.some(({ path }) => path === companion.path)
			)
				grouped.push(companion)
		}
		const coordinatedPaths = new Set([
			...binaryPaths,
			...structuralPaths,
			...palettePaths,
			...[...textChanges.values()].flatMap((group) =>
				group.map(({ path }) => path),
			),
		])
		const coordinatedChanges = changes.filter(
			({ path }) => structuralPaths.has(path) || palettePaths.has(path),
		)
		return [
			...(assetChanges.length === 0
				? []
				: [
						{
							change: aggregateChange(assetChanges),
							id: `design:assets`,
							kind: `asset`,
							label: `Assets`,
							paths: assetChanges.map(({ path }) => path).toSorted() as [
								string,
								...string[],
							],
						},
					]),
			...(fontChanges.length === 0
				? []
				: [
						{
							change: aggregateChange(fontChanges),
							id: `design:fonts`,
							kind: `font`,
							label: `Fonts`,
							paths: fontChanges.map(({ path }) => path).toSorted() as [
								string,
								...string[],
							],
						},
					]),
			...(coordinatedChanges.length === 0
				? []
				: [
						{
							change: aggregateChange(coordinatedChanges),
							id: `design:coordinated-structure`,
							kind: `structure`,
							label: `Coordinated design structure`,
							paths: coordinatedChanges.map(({ path }) => path).toSorted() as [
								string,
								...string[],
							],
						},
					]),
			...[...textChanges.entries()].map(([objectPath, grouped]) => ({
				change: aggregateChange(grouped),
				id: `design:text:${objectPath}`,
				kind: `text`,
				label:
					record(
						grouped.find(({ path }) => path === objectPath)?.after?.value,
					)?.name?.toString() ?? `Text ${objectPath}`,
				paths: grouped.map(({ path }) => path).toSorted() as [
					string,
					...string[],
				],
			})),
			...changes
				.filter(({ path }) => !coordinatedPaths.has(path))
				.map(semanticGroup),
		]
	},
	includesPath(path) {
		return sourceUnitKindForPath(path) !== null
	},
	parseUnit(path, text) {
		const kind = sourceUnitKindForPath(path)
		if (kind === null) {
			throw new SourceValidationError([
				{
					code: `directory.unknown_file`,
					message: `Source unit ${JSON.stringify(path)} is not part of the create-design directory contract.`,
					path: `$`,
					unitPath: path,
				},
			])
		}
		const parsed = parseSourceUnitText(kind, text, path)
		if (!parsed.ok) throw new SourceValidationError(issues(parsed.errors))
		return parsed.value as JsonValue
	},
	validateComparison: validateBinaryComparison,
	validateSnapshot(values) {
		const assembled = assembleDesignDocument(
			values as DesignSourceDirectoryFiles,
		)
		if (!assembled.ok) throw new SourceValidationError(issues(assembled.errors))
	},
}

export function createDesignSourceVersionControl(
	root: string,
	source: SourceService,
): SourceVersionControlService {
	return createSourceVersionControl(
		root,
		() => source.readSnapshot(),
		designSourceVersionControlAdapter,
	)
}

/**
 * Serializes source mutations with review and commit so an accepted optimistic
 * guard always describes the bytes staged by the selective commit.
 */
export function coordinateDesignSourceVersionControl(
	root: string,
	storedSource: SourceService & SourceAssetService,
): Readonly<{
	assets: SourceAssetService
	source: SourceService
	versionControl: SourceVersionControlService
}> {
	let tail: Promise<void> = Promise.resolve()
	const withLock = <Value>(operation: () => Promise<Value>): Promise<Value> => {
		const result = tail.then(operation, operation)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const engine = createDesignSourceVersionControl(root, storedSource)
	return {
		assets: {
			collectExpiredAssetStages: () => storedSource.collectExpiredAssetStages(),
			discardAssetStage: (stagingToken) =>
				storedSource.discardAssetStage(stagingToken),
			readAsset: (path) => storedSource.readAsset(path),
			stageAsset: (input) => storedSource.stageAsset(input),
			writeAssets: (input) => withLock(() => storedSource.writeAssets(input)),
		},
		source: {
			readManifest: () => withLock(() => storedSource.readManifest()),
			readSnapshot: () => withLock(() => storedSource.readSnapshot()),
			readUnit: (path) => withLock(() => storedSource.readUnit(path)),
			...(storedSource.subscribe === undefined
				? {}
				: {
						subscribe: (listener) => storedSource.subscribe!(listener),
					}),
			writeUnit: (input) => withLock(() => storedSource.writeUnit(input)),
			writeUnits: (input) => withLock(() => storedSource.writeUnits(input)),
		},
		versionControl: {
			commitUnits: (input) => withLock(() => engine.commitUnits(input)),
			readComparison: (input) => withLock(() => engine.readComparison(input)),
		},
	}
}
