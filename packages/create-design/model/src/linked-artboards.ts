import type {
	DesignContour,
	DesignDocument,
	DesignLinkedArtboardResource,
	DesignObject,
} from "@create-design/source"

import { objectBounds, projectDesignObjectContours } from "./geometry.ts"
import { projectDesignOutput } from "./output.ts"

export type DesignArtboardLinkDiagnostic = Readonly<{
	code:
		| "artboard-link.missing-project"
		| "artboard-link.missing-artboard"
		| "artboard-link.cycle"
	message: string
	objectId: string
}>

export type DesignArtboardLinkResolution = Readonly<{
	document: DesignDocument
	diagnostics: readonly DesignArtboardLinkDiagnostic[]
}>

function intersects(
	bounds: ReturnType<typeof objectBounds>,
	artboard: DesignDocument["artboards"][number],
): boolean {
	return (
		bounds !== null &&
		bounds.maxX >= artboard.x &&
		bounds.minX <= artboard.x + artboard.width &&
		bounds.maxY >= artboard.y &&
		bounds.minY <= artboard.y + artboard.height
	)
}

function localizeContours(
	contours: readonly DesignContour[],
	x: number,
	y: number,
	prefix: string,
): readonly DesignContour[] {
	return contours.map((contour, contourIndex) => ({
		...contour,
		id: `${prefix}:contour:${contourIndex}`,
		points: contour.points.map((point, pointIndex) => ({
			...point,
			id: `${prefix}:contour:${contourIndex}:point:${pointIndex}`,
			x: point.x - x,
			y: point.y - y,
		})),
	}))
}

/** Materializes links at the shared render/export boundary without touching history. */
export function resolveDesignArtboardLinks(
	document: DesignDocument,
	resources: readonly DesignLinkedArtboardResource[],
): DesignArtboardLinkResolution {
	const byProject = new Map(
		resources.map((resource) => [resource.projectId, resource]),
	)
	const diagnostics: DesignArtboardLinkDiagnostic[] = []
	const resolveObject = (
		object: DesignObject,
		stack: readonly string[],
	): DesignObject => {
		if (object.geometry.kind !== "artboard-link") return object
		const key = `${object.geometry.projectId}/${object.geometry.artboardId}`
		if (stack.includes(key)) {
			diagnostics.push({
				code: "artboard-link.cycle",
				message: `Linked artboard cycle detected at ${key}.`,
				objectId: object.id,
			})
			return object
		}
		const resource = byProject.get(object.geometry.projectId)
		if (resource === undefined) {
			diagnostics.push({
				code: "artboard-link.missing-project",
				message: `Linked design ${object.geometry.projectId} is unavailable.`,
				objectId: object.id,
			})
			return object
		}
		const artboard = resource.document.artboards.find(
			({ id }) => id === object.geometry.artboardId,
		)
		if (artboard === undefined) {
			diagnostics.push({
				code: "artboard-link.missing-artboard",
				message: `Linked artboard ${object.geometry.artboardId} no longer exists in ${object.geometry.projectId}.`,
				objectId: object.id,
			})
			return object
		}
		const nested: DesignDocument = {
			...resource.document,
			objects: resource.document.objects.map((candidate) =>
				resolveObject(candidate, [...stack, key]),
			),
		}
		const contours = projectDesignOutput(nested)
			.objects.filter((candidate) =>
				intersects(objectBounds(candidate), artboard),
			)
			.flatMap((candidate, index) =>
				localizeContours(
					projectDesignObjectContours(candidate),
					artboard.x,
					artboard.y,
					`${object.id}:linked:${index}`,
				),
			)
		return contours.length === 0
			? object
			: {
					...object,
					geometry: { kind: "path", fillRule: "nonzero", contours },
				}
	}
	return {
		document: {
			...document,
			objects: document.objects.map((object) => resolveObject(object, [])),
		},
		diagnostics,
	}
}
