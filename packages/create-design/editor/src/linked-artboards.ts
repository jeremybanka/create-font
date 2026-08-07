import { projectDesignOutput } from "@create-design/model"
import type {
	DesignArtboard,
	DesignDocument,
	DesignLinkedArtboardResource,
	DesignObject,
} from "@create-design/source"

import { appendDesignHierarchyObjects } from "./design-hierarchy.ts"
import type { DesignHierarchyScope } from "./design-hierarchy.ts"

export function placeDesignLinkedArtboard(
	document: DesignDocument,
	resource: DesignLinkedArtboardResource,
	artboard: DesignArtboard,
	target: DesignArtboard,
	scope: DesignHierarchyScope,
	nextId: () => string,
): Readonly<{ document: DesignDocument; object: DesignObject }> {
	const sourceObject = projectDesignOutput(resource.document).objects[0]
	const scale = Math.min(
		1,
		target.width / artboard.width,
		target.height / artboard.height,
	)
	const object: DesignObject = {
		id: `object:${nextId()}`,
		name: `${resource.projectId} — ${artboard.name}`,
		geometry: {
			kind: "artboard-link",
			projectId: resource.projectId,
			artboardId: artboard.id,
			width: artboard.width,
			height: artboard.height,
		},
		transform: {
			a: scale,
			b: 0,
			c: 0,
			d: scale,
			e: target.x + (target.width - artboard.width * scale) / 2,
			f: target.y + (target.height - artboard.height * scale) / 2,
		},
		appearance: sourceObject?.appearance ?? {},
	}
	const withObject = { ...document, objects: [...document.objects, object] }
	return {
		document: appendDesignHierarchyObjects(withObject, [object.id], scope),
		object,
	}
}
