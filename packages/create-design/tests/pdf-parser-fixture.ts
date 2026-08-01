export interface ParsedPdfPageFixture {
	readonly bleedBox?: readonly number[]
	readonly contents: readonly number[]
	readonly mediaBox: readonly number[]
	readonly objectNumber: number
	readonly trimBox?: readonly number[]
}

export interface ParsedPdfFixture {
	readonly objectBodies: ReadonlyMap<number, string>
	readonly pages: readonly ParsedPdfPageFixture[]
	stream(objectNumber: number): string
}

const numbers = (body: string, key: string): readonly number[] | undefined => {
	const match = new RegExp(`/${key} \\[([^\\]]+)\\]`, "u").exec(body)
	return match?.[1]?.trim().split(/\s+/u).map(Number)
}

const references = (body: string, key: string): readonly number[] => {
	const match = new RegExp(`/${key} \\[([^\\]]+)\\]`, "u").exec(body)
	return [...(match?.[1]?.matchAll(/(\d+) 0 R/gu) ?? [])].map((entry) =>
		Number(entry[1]),
	)
}

/** Minimal independent reader for the uncompressed structural PDF fixtures. */
export function parsePdfFixture(bytes: Uint8Array): ParsedPdfFixture {
	const pdf = new TextDecoder().decode(bytes)
	const objectBodies = new Map<number, string>()
	for (const match of pdf.matchAll(
		/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/gu,
	)) {
		const objectNumber = Number(match[1])
		const body = match[2]
		if (body !== undefined) objectBodies.set(objectNumber, body)
	}
	const pagesBody = [...objectBodies.values()].find((body) =>
		/\/Type \/Pages(?:\s|\/)/u.test(body),
	)
	if (pagesBody === undefined) throw new Error("PDF fixture has no page tree.")
	const pageNumbers = references(pagesBody, "Kids")
	const pages = pageNumbers.map((objectNumber) => {
		const body = objectBodies.get(objectNumber)
		if (body === undefined) throw new Error(`Missing PDF page ${objectNumber}.`)
		const mediaBox = numbers(body, "MediaBox")
		if (mediaBox === undefined)
			throw new Error(`PDF page ${objectNumber} has no MediaBox.`)
		return {
			objectNumber,
			mediaBox,
			contents: references(body, "Contents"),
			...(numbers(body, "TrimBox") === undefined
				? {}
				: { trimBox: numbers(body, "TrimBox")! }),
			...(numbers(body, "BleedBox") === undefined
				? {}
				: { bleedBox: numbers(body, "BleedBox")! }),
		}
	})
	return {
		objectBodies,
		pages,
		stream(objectNumber) {
			const body = objectBodies.get(objectNumber)
			const match = body?.match(/stream\n([\s\S]*?)\nendstream/u)
			if (match?.[1] === undefined)
				throw new Error(`PDF object ${objectNumber} is not a stream.`)
			return match[1]
		},
	}
}
