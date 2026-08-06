import { appendDesignHierarchyObjects } from "./design-hierarchy.ts"
import type { DesignHierarchyScope } from "./design-hierarchy.ts"
import type {
	DesignDocument,
	DesignImageSource,
	DesignObject,
} from "./types.ts"

export type PlaceDesignImageInput = Readonly<{
	name: string
	source: DesignImageSource
	mediaType: "image/jpeg" | "image/png"
	intrinsicWidth: number
	intrinsicHeight: number
	scale?: number
	x?: number
	y?: number
}>

export function placeDesignImage(
	document: DesignDocument,
	input: PlaceDesignImageInput,
	scope: DesignHierarchyScope,
	nextId: () => string,
): Readonly<{ document: DesignDocument; object: DesignObject }> {
	if (!(input.intrinsicWidth > 0) || !(input.intrinsicHeight > 0))
		throw new Error("Placed images require positive intrinsic dimensions.")
	const scale = input.scale ?? 1
	if (!(scale > 0) || !Number.isFinite(scale))
		throw new Error("Placed image scale must be finite and positive.")
	const object: DesignObject = {
		id: `object:${nextId()}`,
		name: input.name,
		geometry: {
			kind: "image",
			source: input.source,
			mediaType: input.mediaType,
			intrinsicWidth: input.intrinsicWidth,
			intrinsicHeight: input.intrinsicHeight,
		},
		transform: {
			a: scale,
			b: 0,
			c: 0,
			d: scale,
			e: input.x ?? 0,
			f: input.y ?? 0,
		},
		appearance: {},
	}
	const withObject = { ...document, objects: [...document.objects, object] }
	return {
		document: appendDesignHierarchyObjects(withObject, [object.id], scope),
		object,
	}
}

export function updateDesignImageSource(
	document: DesignDocument,
	objectId: string,
	source: DesignImageSource,
	mediaType?: "image/jpeg" | "image/png",
): DesignDocument {
	let found = false
	const objects = document.objects.map((object) => {
		if (object.id !== objectId || object.geometry.kind !== "image")
			return object
		found = true
		return {
			...object,
			geometry: {
				...object.geometry,
				source,
				...(mediaType === undefined ? {} : { mediaType }),
			},
		}
	})
	if (!found) throw new Error(`Cannot relink missing placed image ${objectId}.`)
	return { ...document, objects }
}
