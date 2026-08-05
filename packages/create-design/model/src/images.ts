import { projectDesignEffectiveHierarchy } from "./hierarchy.ts"
import type {
	DesignDocument,
	DesignImageResource,
	DesignObject,
} from "@create-design/source"

export type DesignImageDiagnostic = Readonly<{
	code: "image.missing-resource" | "image.media-type-mismatch"
	message: string
	objectId: string
	severity: "error" | "warning"
	sourceId: string
}>

export type DesignImageResolution = Readonly<{
	object: DesignObject & {
		readonly geometry: Extract<
			DesignObject["geometry"],
			Readonly<{ kind: "image" }>
		>
	}
	resource: DesignImageResource | null
	diagnostics: readonly DesignImageDiagnostic[]
	maskGroupIds: readonly string[]
}>

/** Resolves runtime bytes without removing or rewriting missing linked objects. */
export function resolveDesignImages(
	document: DesignDocument,
	resources: ReadonlyMap<string, DesignImageResource> = new Map(),
): readonly DesignImageResolution[] {
	const hierarchy = projectDesignEffectiveHierarchy(document)
	return document.objects.flatMap((candidate) => {
		if (candidate.geometry.kind !== "image") return []
		const object = candidate as DesignImageResolution["object"]
		const source = object.geometry.source
		const resource = resources.get(source.id) ?? null
		const diagnostics: DesignImageDiagnostic[] = []
		if (resource === null) {
			diagnostics.push({
				code: "image.missing-resource",
				message:
					source.kind === "linked"
						? `${object.name} cannot read linked image ${source.href}; relink it or embed replacement bytes.`
						: `${object.name} cannot read embedded asset ${source.id}; restore or replace the asset bytes.`,
				objectId: object.id,
				severity: source.kind === "linked" ? "warning" : "error",
				sourceId: source.id,
			})
		} else if (resource.mediaType !== object.geometry.mediaType) {
			diagnostics.push({
				code: "image.media-type-mismatch",
				message: `${object.name} declares ${object.geometry.mediaType} but ${source.id} resolved as ${resource.mediaType}.`,
				objectId: object.id,
				severity: "error",
				sourceId: source.id,
			})
		}
		return [
			Object.freeze({
				object,
				resource,
				diagnostics: Object.freeze(diagnostics),
				maskGroupIds:
					hierarchy.byObjectId.get(object.id)?.maskGroupIds ??
					Object.freeze([]),
			}),
		]
	})
}
