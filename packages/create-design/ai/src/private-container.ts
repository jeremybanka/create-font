import * as zlib from "node:zlib"

export const MAX_ILLUSTRATOR_FILE_BYTES = 256 * 1024 * 1024
export const MAX_ILLUSTRATOR_SOURCE_BYTES = 64 * 1024 * 1024

export interface IllustratorPrivateSource {
	readonly compression: "deflate" | "none" | "zstd"
	readonly text: string
}

export type IllustratorPrivateSourceDecodeResult =
	| Readonly<{ ok: true; value: IllustratorPrivateSource }>
	| Readonly<{
			ok: false
			code:
				| "ai.import.file-limit"
				| "ai.import.private-source-corrupt"
				| "ai.import.private-source-limit"
				| "ai.import.private-source-missing"
				| "ai.import.zstd-unavailable"
			message: string
	  }>

type PdfObject = Readonly<{
	id: number
	generation: number
	body: string
	dictionary: string
	stream?: Uint8Array
}>

type PdfObjects = Readonly<{
	objects: Map<string, PdfObject>
	error?: string
}>

const latin1 = new TextDecoder("latin1")

function findKeyword(
	source: string,
	start: number,
	keywords: readonly string[],
): Readonly<{ index: number; keyword: string }> | undefined {
	const delimiter = (character: string | undefined): boolean =>
		character === undefined || /[\s()<>{}[\]/%]/u.test(character)
	for (let index = start; index < source.length; index++) {
		const character = source[index]
		if (character === "%") {
			const lf = source.indexOf("\n", index)
			const cr = source.indexOf("\r", index)
			const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr)
			if (end < 0) return undefined
			index = end
			continue
		}
		if (character === "/") {
			while (index + 1 < source.length && !delimiter(source[index + 1])) index++
			continue
		}
		if (character === "(") {
			let depth = 1
			for (index++; index < source.length && depth > 0; index++) {
				if (source[index] === "\\") index++
				else if (source[index] === "(") depth++
				else if (source[index] === ")") depth--
			}
			index--
			continue
		}
		for (const keyword of keywords)
			if (
				source.startsWith(keyword, index) &&
				delimiter(source[index - 1]) &&
				delimiter(source[index + keyword.length])
			)
				return { index, keyword }
	}
	return undefined
}

const objectKey = (id: number, generation: number): string =>
	`${id}:${generation}`

function parsePdfObjects(bytes: Uint8Array): PdfObjects {
	const source = latin1.decode(bytes)
	const result = new Map<string, PdfObject>()
	const pattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b/gu
	let match: RegExpExecArray | null
	while ((match = pattern.exec(source)) !== null) {
		const id = Number(match[1])
		const generation = Number(match[2])
		const key = objectKey(id, generation)
		if (result.has(key))
			return {
				objects: result,
				error: `PDF object ${id} ${generation} is defined more than once.`,
			}
		const start = match.index + match[0].length
		const marker = findKeyword(source, start, ["stream", "endobj"])
		if (marker === undefined) continue
		if (marker.keyword === "endobj") {
			const body = source.slice(start, marker.index)
			result.set(key, { id, generation, body, dictionary: body })
			pattern.lastIndex = marker.index + 6
			continue
		}
		const dictionary = source.slice(start, marker.index)
		let streamStart = marker.index + 6
		if (bytes[streamStart] === 13) streamStart++
		if (bytes[streamStart] === 10) streamStart++
		const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/u.exec(dictionary)
		let streamEnd =
			length === null
				? source.indexOf("endstream", streamStart)
				: streamStart + Number(length[1])
		if (streamEnd < streamStart) continue
		if (length === null)
			while (bytes[streamEnd - 1] === 10 || bytes[streamEnd - 1] === 13)
				streamEnd--
		const endStream = findKeyword(source, streamEnd, ["endstream"])
		const endObject =
			endStream === undefined
				? undefined
				: findKeyword(source, endStream.index + endStream.keyword.length, [
						"endobj",
					])
		if (endObject === undefined) continue
		result.set(key, {
			id,
			generation,
			body: source.slice(start, endObject.index),
			dictionary,
			stream: bytes.slice(streamStart, streamEnd),
		})
		pattern.lastIndex = endObject.index + 6
	}
	return { objects: result }
}

function referencedObject(
	dictionary: string,
	name: string,
): Readonly<{ id: number; generation: number }> | undefined {
	const match = new RegExp(`/${name}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`, "u").exec(
		dictionary,
	)
	return match === null
		? undefined
		: { id: Number(match[1]), generation: Number(match[2]) }
}

type PieceInfoResult = Readonly<{ descriptors: Set<string>; error?: string }>

function catalogReference(
	source: string,
): Readonly<{ id: number; generation: number }> | undefined {
	const trailerAt = source.lastIndexOf("trailer")
	if (trailerAt < 0) return undefined
	const startXrefAt = source.indexOf("startxref", trailerAt)
	return referencedObject(
		source.slice(trailerAt, startXrefAt < 0 ? source.length : startXrefAt),
		"Root",
	)
}

function illustratorPrivateDescriptors(
	objects: Map<string, PdfObject>,
	source: string,
): PieceInfoResult {
	const descriptors = new Set<string>()
	const rootReference = catalogReference(source)
	if (rootReference === undefined) return { descriptors }
	const root = objects.get(
		objectKey(rootReference.id, rootReference.generation),
	)
	if (root === undefined)
		return {
			descriptors,
			error: "The PDF trailer references a missing catalog object.",
		}
	let error: string | undefined
	const inspectOwner = (owner: PdfObject): void => {
		if (error !== undefined || !/\/PieceInfo\b/u.test(owner.dictionary)) return
		const pieceInfoReference = referencedObject(owner.dictionary, "PieceInfo")
		const pieceInfo =
			pieceInfoReference === undefined
				? owner
				: objects.get(
						objectKey(pieceInfoReference.id, pieceInfoReference.generation),
					)
		if (pieceInfo === undefined) {
			error = "The catalog-reachable Illustrator PieceInfo object is missing."
			return
		}
		const inline =
			/\/Illustrator\s*<<[\s\S]*?\/Private\s+(\d+)\s+(\d+)\s+R\b/u.exec(
				pieceInfo.dictionary,
			)
		if (inline !== null) {
			descriptors.add(objectKey(Number(inline[1]), Number(inline[2])))
			return
		}
		const illustratorReference = referencedObject(
			pieceInfo.dictionary,
			"Illustrator",
		)
		if (illustratorReference === undefined) return
		const illustrator = objects.get(
			objectKey(illustratorReference.id, illustratorReference.generation),
		)
		if (illustrator === undefined) {
			error = "The catalog-reachable Illustrator PieceInfo entry is missing."
			return
		}
		const privateReference = referencedObject(illustrator.dictionary, "Private")
		if (privateReference === undefined) {
			error =
				"The catalog-reachable Illustrator PieceInfo entry has no Private descriptor."
			return
		}
		descriptors.add(objectKey(privateReference.id, privateReference.generation))
	}
	inspectOwner(root)
	const pagesReference = referencedObject(root.dictionary, "Pages")
	const pending = pagesReference === undefined ? [] : [pagesReference]
	const visited = new Set<string>()
	while (pending.length > 0 && visited.size < 10_000 && error === undefined) {
		const reference = pending.pop()!
		const key = objectKey(reference.id, reference.generation)
		if (visited.has(key)) continue
		visited.add(key)
		const object = objects.get(key)
		if (object === undefined) {
			error = "The PDF catalog page tree contains a missing object."
			break
		}
		inspectOwner(object)
		const kids = /\/Kids\s*\[([^\]]*)\]/u.exec(object.dictionary)?.[1]
		if (kids !== undefined)
			for (const match of kids.matchAll(/(\d+)\s+(\d+)\s+R\b/gu))
				pending.push({ id: Number(match[1]), generation: Number(match[2]) })
	}
	if (pending.length > 0 && error === undefined)
		error =
			"The PDF catalog page tree exceeds the 10000-object validation limit."
	return error === undefined ? { descriptors } : { descriptors, error }
}

function fail(
	code: Exclude<IllustratorPrivateSourceDecodeResult, { ok: true }>["code"],
	message: string,
): IllustratorPrivateSourceDecodeResult {
	return { ok: false, code, message }
}

/** Extracts and decompresses Illustrator's revisable source from its PDF container. */
export function decodeIllustratorPrivateSource(
	bytes: Uint8Array,
): IllustratorPrivateSourceDecodeResult {
	if (bytes.byteLength > MAX_ILLUSTRATOR_FILE_BYTES)
		return fail(
			"ai.import.file-limit",
			`The Illustrator file exceeds the ${MAX_ILLUSTRATOR_FILE_BYTES}-byte import limit.`,
		)
	const direct = latin1.decode(bytes)
	if (direct.startsWith("%!PS-Adobe"))
		return /%%Creator:.*Adobe Illustrator/iu.test(direct)
			? { ok: true, value: { compression: "none", text: direct } }
			: fail(
					"ai.import.private-source-missing",
					"The PostScript program was not authored by Adobe Illustrator.",
				)
	const parsedObjects = parsePdfObjects(bytes)
	if (parsedObjects.error !== undefined)
		return fail("ai.import.private-source-corrupt", parsedObjects.error)
	const objects = parsedObjects.objects
	const descriptors = [...objects.values()].filter(({ dictionary }) =>
		/\/AIPrivateData1\s+\d+\s+\d+\s+R/u.test(dictionary),
	)
	if (descriptors.length === 0)
		return fail(
			"ai.import.private-source-missing",
			"The file does not contain recoverable Illustrator private source. Re-save it from Illustrator with PDF compatibility and preserve Illustrator editing capabilities.",
		)
	if (descriptors.length > 1)
		return fail(
			"ai.import.private-source-corrupt",
			"The PDF contains multiple ambiguous Illustrator private-source descriptors.",
		)
	const descriptor = descriptors[0]!
	const pieceInfo = illustratorPrivateDescriptors(objects, direct)
	if (pieceInfo.error !== undefined)
		return fail("ai.import.private-source-corrupt", pieceInfo.error)
	const pieceInfoDescriptors = pieceInfo.descriptors
	if (
		pieceInfoDescriptors.size > 0 &&
		!pieceInfoDescriptors.has(objectKey(descriptor.id, descriptor.generation))
	)
		return fail(
			"ai.import.private-source-corrupt",
			"The Illustrator PieceInfo chain does not reference the private-source descriptor.",
		)
	const references = [
		...descriptor.dictionary.matchAll(
			/\/AIPrivateData(\d+)\s+(\d+)\s+(\d+)\s+R/gu,
		),
	]
		.map((match) => ({
			part: Number(match[1]),
			id: Number(match[2]),
			generation: Number(match[3]),
		}))
		.sort((left, right) => left.part - right.part)
	if (references.length === 0)
		return fail(
			"ai.import.private-source-corrupt",
			"The Illustrator private-source descriptor contains no data blocks.",
		)
	const declaredBlocks = /\/NumBlock\s+(\d+)/u.exec(descriptor.dictionary)
	if (
		new Set(references.map(({ part }) => part)).size !== references.length ||
		references.some(({ part }, index) => part !== index + 1) ||
		(declaredBlocks !== null && Number(declaredBlocks[1]) !== references.length)
	)
		return fail(
			"ai.import.private-source-corrupt",
			"Illustrator private-source part numbers must be unique, contiguous, and match NumBlock.",
		)
	const chunks: Uint8Array[] = []
	let total = 0
	for (const { id, generation } of references) {
		const object = objects.get(objectKey(id, generation))
		if (object?.stream === undefined)
			return fail(
				"ai.import.private-source-corrupt",
				[...objects.values()].some((candidate) => candidate.id === id)
					? `Illustrator private-source block ${id} has a generation mismatch; expected generation ${generation}.`
					: `Illustrator private-source block ${id} ${generation} is missing.`,
			)
		if (/\/Filter\b/u.test(object.dictionary))
			return fail(
				"ai.import.private-source-corrupt",
				"A private-source block uses an unsupported PDF stream filter.",
			)
		if (!/\/Length\s+\d+(?!\s+\d+\s+R)/u.test(object.dictionary))
			return fail(
				"ai.import.private-source-corrupt",
				"Each Illustrator private-source block must have a direct, bounded PDF stream Length.",
			)
		total += object.stream.byteLength
		if (total > MAX_ILLUSTRATOR_FILE_BYTES)
			return fail(
				"ai.import.private-source-limit",
				"The compressed Illustrator private source exceeds the import limit.",
			)
		chunks.push(object.stream)
	}
	const packed = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		packed.set(chunk, offset)
		offset += chunk.byteLength
	}
	const packedText = latin1.decode(packed)
	const deflateMarker = "%AI12_CompressedData"
	const zstdMarker = "%AI24_ZStandard_Data"
	const deflateAt = packedText.indexOf(deflateMarker)
	const zstdAt = packedText.indexOf(zstdMarker)
	let decoded: Uint8Array
	let compression: IllustratorPrivateSource["compression"]
	try {
		if (deflateAt >= 0) {
			compression = "deflate"
			decoded = zlib.inflateSync(
				packed.subarray(deflateAt + deflateMarker.length),
				{
					maxOutputLength: MAX_ILLUSTRATOR_SOURCE_BYTES,
				},
			)
		} else if (zstdAt >= 0) {
			compression = "zstd"
			const decompress = (
				zlib as typeof zlib & {
					zstdDecompressSync?: (
						data: Uint8Array,
						options?: { maxOutputLength: number },
					) => Uint8Array
				}
			).zstdDecompressSync
			if (decompress === undefined)
				return fail(
					"ai.import.zstd-unavailable",
					"This file uses Illustrator zstd source compression, which requires Node.js 22.15 or newer.",
				)
			decoded = decompress(packed.subarray(zstdAt + zstdMarker.length), {
				maxOutputLength: MAX_ILLUSTRATOR_SOURCE_BYTES,
			})
		} else
			return fail(
				"ai.import.private-source-corrupt",
				"The Illustrator private source has no recognized compression marker.",
			)
	} catch (error) {
		return fail(
			String(error).toLowerCase().includes("larger")
				? "ai.import.private-source-limit"
				: "ai.import.private-source-corrupt",
			`The Illustrator private source could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
	const text = latin1.decode(decoded)
	if (!text.startsWith("%!PS-Adobe"))
		return fail(
			"ai.import.private-source-corrupt",
			"The decompressed Illustrator source has an invalid header.",
		)
	return { ok: true, value: { compression, text } }
}
