import { basename, dirname, resolve } from "node:path"

import {
	assembleDesignDocument,
	assetIndexFileSchema,
	fontIndexFileSchema,
	type DesignFontResource,
	type DesignImageResource,
	type DesignLinkedArtboardResource,
} from "@create-design/source"

import { createDesignSourceService } from "./source-service.ts"
import { discoverDesignProjects } from "./workspace.ts"

/** Loads sibling designs and their runtime assets for headless link projection. */
export async function loadDesignLinkedArtboardResources(
	activeRoot: string,
): Promise<readonly DesignLinkedArtboardResource[]> {
	const designsRoot = dirname(activeRoot)
	if (basename(designsRoot) !== "designs") return []
	const projects = await discoverDesignProjects(dirname(designsRoot))
	return Promise.all(
		projects
			.filter(({ root }) => resolve(root) !== resolve(activeRoot))
			.map(async (project) => {
				const source = await createDesignSourceService(project.root, {
					initialize: false,
				})
				const snapshot = await source.readSnapshot()
				const assembled = assembleDesignDocument(
					Object.fromEntries(
						snapshot.units.map(({ path, value }) => [path, value]),
					),
				)
				if (!assembled.ok)
					throw new Error(
						`Linked design ${project.name} contains invalid source.`,
					)
				const assetIndex = assetIndexFileSchema.safeParse(
					snapshot.units.find(({ path }) => path === "assets/index.json")
						?.value,
				)
				const images: DesignImageResource[] = []
				if (assetIndex.success)
					for (const entry of assetIndex.data.entries) {
						if (
							entry.mediaType !== "image/jpeg" &&
							entry.mediaType !== "image/png"
						)
							continue
						const asset = await source.readAsset(entry.path)
						images.push({
							id: entry.id,
							mediaType: entry.mediaType,
							bytes: new Uint8Array(
								await new Response(asset.bytes).arrayBuffer(),
							),
						})
					}
				const fontIndex = fontIndexFileSchema.safeParse(
					snapshot.units.find(({ path }) => path === "fonts/index.json")?.value,
				)
				const fonts: DesignFontResource[] = []
				if (fontIndex.success)
					for (const entry of fontIndex.data.entries) {
						const asset = await source.readAsset(entry.path)
						fonts.push({
							reference: {
								id: entry.id,
								family: entry.family ?? entry.id.slice("font:".length),
								...(entry.faceIndex === undefined
									? {}
									: { faceIndex: entry.faceIndex }),
								revision: entry.revision ?? asset.descriptor.digest,
							},
							bytes: new Uint8Array(
								await new Response(asset.bytes).arrayBuffer(),
							),
						})
					}
				return {
					projectId: project.name,
					revision: snapshot.revision,
					document: assembled.value,
					images,
					fonts,
				}
			}),
	)
}
