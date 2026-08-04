import { mkdir, readdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type {
	JsonValue,
	SourceAssetService,
	SourceService,
} from "@create-art/source-rpc"
import {
	createFileSystemSourceService,
	type JsonSourceWorkspaceCodec,
} from "@create-art/source-rpc/node"
import {
	assembleDesignDocument,
	assetUnitPathSchema,
	fontIndexFileSchema,
	fontUnitPathSchema,
	formatSourceUnit,
	parseSourceUnitText,
	sourceUnitKindForPath,
	splitDesignDocument,
	validateSourceUnit,
	createInitialDocument,
	type AssetIndexFile,
	type DesignDocument,
	type DesignSourceDiagnostic,
	type DesignSourceDirectoryFiles,
	type DesignSourceUnitKind,
} from "@create-design/source"

function issues(errors: readonly DesignSourceDiagnostic[]) {
	return errors.map(({ code, message, path, unitPath }) => ({
		code,
		message,
		path,
		...(unitPath === undefined ? {} : { unitPath }),
	})) as [
		{
			code: string
			message: string
			path: string
			unitPath?: string
		},
		...{
			code: string
			message: string
			path: string
			unitPath?: string
		}[],
	]
}

export const designSourceWorkspaceCodec: JsonSourceWorkspaceCodec<DesignSourceUnitKind> =
	{
		assets: {
			descriptors(files) {
				const path = `assets/index.json`
				const validated = validateSourceUnit(`asset-index`, files[path], path)
				if (!validated.ok) {
					return { ok: false, errors: issues(validated.errors) }
				}
				const index = validated.value as AssetIndexFile
				const fontPath = `fonts/index.json`
				const fonts = fontIndexFileSchema.safeParse(files[fontPath])
				if (!fonts.success)
					return {
						ok: false as const,
						errors: [
							{
								code: "source.schema",
								message: "Invalid font inventory.",
								path: "$",
								unitPath: fontPath,
							},
						] as [
							{ code: string; message: string; path: string; unitPath: string },
						],
					}
				return {
					ok: true,
					value: [
						...index.entries.map((entry) => ({
							byteLength: entry.byteLength,
							digest: `sha256:${entry.sha256}` as const,
							id: entry.id,
							mediaType: entry.mediaType,
							path: entry.path,
						})),
						...fonts.data.entries.map((entry) => ({
							byteLength: 0,
							digest: `sha256:${entry.sha256}` as const,
							id: entry.id,
							mediaType: entry.path.endsWith(".otf")
								? "font/otf"
								: entry.path.endsWith(".woff2")
									? "font/woff2"
									: entry.path.endsWith(".woff")
										? "font/woff"
										: "font/ttf",
							path: entry.path,
						})),
					],
				}
			},
			isPath(path) {
				return (
					assetUnitPathSchema.safeParse(path).success ||
					fontUnitPathSchema.safeParse(path).success
				)
			},
		},
		assemble(files) {
			const result = assembleDesignDocument(files as DesignSourceDirectoryFiles)
			return result.ok
				? { ok: true, value: result.value }
				: { ok: false, errors: issues(result.errors) }
		},
		format(kind, value) {
			const result = formatSourceUnit(kind, value)
			return result.ok
				? { ok: true, value: result.value }
				: { ok: false, errors: issues(result.errors) }
		},
		kindForPath: sourceUnitKindForPath,
		parse(kind, text, path) {
			const result = parseSourceUnitText(kind, text, path)
			return result.ok
				? { ok: true, value: result.value as JsonValue }
				: { ok: false, errors: issues(result.errors) }
		},
	}

export async function initializeDesignSourceWorkspace(
	rootInput: string,
	document: DesignDocument = createInitialDocument(),
): Promise<string> {
	const root = resolve(rootInput)
	await mkdir(root, { recursive: true })
	const entries = await readdir(root)
	if (entries.length > 0) return root
	const split = splitDesignDocument(document)
	if (!split.ok) {
		throw new Error(split.errors.map(({ message }) => message).join(`\n`))
	}
	for (const [path, value] of Object.entries(split.value)) {
		const kind = sourceUnitKindForPath(path)
		if (kind === null)
			throw new Error(`Unsupported design source path: ${path}`)
		const formatted = formatSourceUnit(kind, value)
		if (!formatted.ok) {
			throw new Error(formatted.errors.map(({ message }) => message).join(`\n`))
		}
		const target = resolve(root, path)
		await mkdir(dirname(target), { recursive: true })
		await writeFile(target, formatted.value)
	}
	return root
}

export async function createDesignSourceService(
	rootInput: string,
	options: Readonly<{ initialize?: boolean }> = {},
): Promise<SourceService & SourceAssetService> {
	const root =
		options.initialize === false
			? resolve(rootInput)
			: await initializeDesignSourceWorkspace(rootInput)
	return createFileSystemSourceService(root, designSourceWorkspaceCodec, {
		controlDirectory: `.create-design`,
	})
}

export {
	coordinateDesignSourceVersionControl,
	createDesignSourceVersionControl,
	designSourceVersionControlAdapter,
} from "./version-control.ts"
