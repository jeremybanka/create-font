import type { DesignArtboard, DesignDocument } from "./types.ts"

/** Resolves noncanonical active-artboard state without persisting it. */
export function activeDesignArtboard(
	document: Pick<DesignDocument, "artboards">,
	id?: string | null,
): DesignArtboard {
	const artboard =
		(id === undefined || id === null
			? undefined
			: document.artboards.find((candidate) => candidate.id === id)) ??
		document.artboards[0]
	if (artboard === undefined)
		throw new Error("A create-design document requires at least one artboard.")
	return artboard
}
