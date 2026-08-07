import { objectBounds, projectDesignOutput } from "@create-design/model"
import type {
	DesignAppearance,
	DesignArtboard,
	DesignDocument,
	DesignLinkedArtboardResource,
	DesignObject,
	DesignSwatch,
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
	const sourceObject = projectDesignOutput(resource.document).objects.find(
		(candidate) => {
			const bounds = objectBounds(candidate)
			return (
				bounds !== null &&
				bounds.maxX >= artboard.x &&
				bounds.minX <= artboard.x + artboard.width &&
				bounds.maxY >= artboard.y &&
				bounds.minY <= artboard.y + artboard.height
			)
		},
	)
	const imported = importLinkedAppearance(
		document.swatches,
		resource.document.swatches,
		sourceObject?.appearance ?? {},
		resource.projectId,
		nextId,
	)
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
		appearance: imported.appearance,
	}
	const withObject = {
		...document,
		swatches: imported.swatches,
		objects: [...document.objects, object],
	}
	return {
		document: appendDesignHierarchyObjects(withObject, [object.id], scope),
		object,
	}
}

function sameSwatch(left: DesignSwatch, right: DesignSwatch): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function importLinkedAppearance(
	target: readonly DesignSwatch[],
	source: readonly DesignSwatch[],
	appearance: DesignAppearance,
	projectId: string,
	nextId: () => string,
): Readonly<{
	appearance: DesignAppearance
	swatches: readonly DesignSwatch[]
}> {
	const swatches = [...target]
	const importedIds = new Map<string, string>()
	const importPaint = <Paint extends { readonly swatchId: string }>(
		paint: Paint | undefined,
	): Paint | undefined => {
		if (paint === undefined) return
		const cached = importedIds.get(paint.swatchId)
		if (cached !== undefined) return { ...paint, swatchId: cached }
		const sourceSwatch = source.find(({ id }) => id === paint.swatchId)
		if (sourceSwatch === undefined) return
		const equivalent = swatches.find((candidate) =>
			sameSwatch(candidate, sourceSwatch),
		)
		if (equivalent !== undefined) {
			importedIds.set(paint.swatchId, equivalent.id)
			return { ...paint, swatchId: equivalent.id }
		}
		const id = swatches.some(({ id }) => id === sourceSwatch.id)
			? `swatch:linked:${projectId.replaceAll(/[^a-z0-9._-]+/giu, "-")}:${nextId()}`
			: sourceSwatch.id
		swatches.push({ ...sourceSwatch, id })
		importedIds.set(paint.swatchId, id)
		return { ...paint, swatchId: id }
	}
	const fill = importPaint(appearance.fill)
	const stroke = importPaint(appearance.stroke)
	return {
		swatches,
		appearance: {
			...(fill === undefined ? {} : { fill }),
			...(stroke === undefined ? {} : { stroke }),
		},
	}
}
