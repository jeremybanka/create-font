import { deflateSync, zstdCompressSync } from "node:zlib"

function join(parts: readonly (string | Uint8Array)[]): Uint8Array {
	const values = parts.map((part) =>
		typeof part === "string" ? new TextEncoder().encode(part) : part,
	)
	const result = new Uint8Array(
		values.reduce((sum, value) => sum + value.length, 0),
	)
	let offset = 0
	for (const value of values) {
		result.set(value, offset)
		offset += value.length
	}
	return result
}

export function privateAiFixture(
	source: string,
	options: Readonly<{
		parts?: readonly number[]
		descriptor?: string
		adversarialStream?: string
		compression?: "deflate" | "zstd"
		chunkGenerations?: readonly number[]
		descriptorGeneration?: number
		extraObjects?: readonly string[]
		pieceInfoDescriptor?: Readonly<{ id: number; generation: number }>
	}> = {},
): Uint8Array {
	const packed =
		options.compression === "zstd"
			? join(["%AI24_ZStandard_Data", zstdCompressSync(source)])
			: join(["%AI12_CompressedData", deflateSync(source)])
	const cuts = options.parts ?? [packed.length]
	const chunks: Uint8Array[] = []
	let from = 0
	for (const to of cuts) {
		chunks.push(packed.slice(from, to))
		from = to
	}
	if (from < packed.length) chunks.push(packed.slice(from))
	const descriptor =
		options.descriptor ??
		`/NumBlock ${chunks.length} ${chunks.map((_chunk, index) => `/AIPrivateData${index + 1} ${10 + index} ${options.chunkGenerations?.[index] ?? 0} R`).join(" ")}`
	const descriptorGeneration = options.descriptorGeneration ?? 0
	const objects: (string | Uint8Array)[] = [
		"%PDF-1.7\n",
		`1 ${descriptorGeneration} obj<<${descriptor}>>endobj\n`,
	]
	if (options.pieceInfoDescriptor !== undefined)
		objects.push(
			`3 0 obj<</Type/Catalog/PieceInfo<</Illustrator<</Private ${options.pieceInfoDescriptor.id} ${options.pieceInfoDescriptor.generation} R>>>>>>endobj\n`,
		)
	objects.push(...(options.extraObjects ?? []))
	if (options.adversarialStream !== undefined)
		objects.push(
			`2 0 obj<</Length ${options.adversarialStream.length}>>stream\n${options.adversarialStream}endstream\nendobj\n`,
		)
	for (let index = chunks.length - 1; index >= 0; index--) {
		const chunk = chunks[index]!
		objects.push(
			`${10 + index} ${options.chunkGenerations?.[index] ?? 0} obj<</Length ${chunk.length}>>stream\n`,
			chunk,
			"\nendstream\nendobj\n",
		)
	}
	if (options.pieceInfoDescriptor !== undefined)
		objects.push("trailer\n<</Root 3 0 R>>\nstartxref\n0\n")
	objects.push("%%EOF\n")
	return join(objects)
}

export function sourceFixture(): string {
	return [
		"%!PS-Adobe-3.0",
		"%%Creator: Adobe Illustrator",
		"%%HiResBoundingBox: -20 -30 250 100",
		"%_/Dictionary :",
		"%_0 100 /RealPointRelToROrigin %_ (PositionPoint1)",
		"%_100 0 /RealPointRelToROrigin %_ (PositionPoint2)",
		"%_(First) /UnicodeString (Name)",
		"%_/Dictionary :",
		"%_50 50 /RealPointRelToROrigin %_ (PositionPoint1)",
		"%_150 -50 /RealPointRelToROrigin %_ (PositionPoint2)",
		"%_(Overlap) /UnicodeString (Name)",
		"%_; (ArtboardArray)",
		"%AI5_BeginLayer",
		"1 1 1 1 0 0 1 0 255 79 79 0 50 0 Lb",
		"(Artwork) Ln",
		"0 0.5 1 0 (Orange) 0 0 Xk",
		"-20 10 m 20 10 L 20 -10 L -20 -10 L f",
		"0 1 0 0 0 1 0 XA 4 w 1 J 2 j 8 M [3 2] 1 d -10 -20 m 10 -20 L S",
		"u",
		"0 0 0 0 k",
		"0 0 m 10 0 L 10 10 L f",
		"U",
		"20 20 m 30 20 L 30 30 L f",
		"*u",
		"1 0 0 0 k 40 0 m 60 0 L 60 20 L f",
		"40 5 m 50 5 L 50 15 L f",
		"*U",
		"q 70 0 m 90 0 L 90 20 L 70 20 L h W",
		"0 1 0 0 k 60 -10 m 100 -10 L 100 30 L 60 30 L f Q",
		"LB",
		"%%PageTrailer",
	].join("\r")
}

function utf16be(value: string): string {
	let result = "\xfe\xff"
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index)
		result += String.fromCharCode(code >>> 8, code & 255)
	}
	return result
}

function ascii85(value: string): string {
	const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))
	let result = ""
	for (let offset = 0; offset < bytes.length; offset += 4) {
		const count = Math.min(4, bytes.length - offset)
		let word = 0
		for (let index = 0; index < 4; index++)
			word = word * 256 + (bytes[offset + index] ?? 0)
		const digits = Array<number>(5)
		for (let index = 4; index >= 0; index--) {
			digits[index] = word % 85
			word = Math.floor(word / 85)
		}
		result += digits
			.slice(0, count + 1)
			.map((digit) => String.fromCharCode(digit + 33))
			.join("")
	}
	return result
}

export function textSourceFixture(story = "Hello\r"): string {
	const decoded = `(${utf16be("Brahmin-5r")}) >> >> (${utf16be(story)}) /6 << /0 2 /1 12 /91 0 >> /99 /F /10 0 /0 << /0 [ 8202 8212 ] >>`
	const resource = [
		"%AI11_BeginTextDocument",
		"/AI11TextDocument : /ASCII85Decode ,",
		`%${ascii85(decoded)}~>`,
		";",
		"%AI11_EndTextDocument",
	].join("\r")
	return sourceFixture()
		.replace("%AI5_BeginLayer", `${resource}\r%AI5_BeginLayer`)
		.replace(
			"-20 10 m 20 10 L 20 -10 L -20 -10 L f",
			"-20 10 m 20 10 L 20 -10 L -20 -10 L f\r/AI11Text :\r0 /FreeUndo ,\r0 /FrameIndex ,\r0 /StoryIndex ,\r2 /TextAntialiasing ,\r;",
		)
}
