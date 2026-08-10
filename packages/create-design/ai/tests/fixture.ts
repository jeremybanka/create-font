import { deflateSync } from "node:zlib"

type FixtureOptions = Readonly<{
	content?: string
	filter?: "flate" | "unsupported"
	pageBox?: string
	version?: string
}>

function joinBytes(parts: readonly (string | Uint8Array)[]): Uint8Array {
	const encoded = parts.map((part) =>
		typeof part === "string" ? new TextEncoder().encode(part) : part,
	)
	const result = new Uint8Array(
		encoded.reduce((sum, part) => sum + part.byteLength, 0),
	)
	let offset = 0
	for (const part of encoded) {
		result.set(part, offset)
		offset += part.byteLength
	}
	return result
}

export function pdfBytes(parts: readonly (string | Uint8Array)[]): Uint8Array {
	return joinBytes([
		"%PDF-1.4\n% Adobe Illustrator fixture\n",
		...parts,
		"%%EOF\n",
	])
}

export function illustratorFixture(options: FixtureOptions = {}): Uint8Array {
	const content = options.content ?? "1 0 0 rg 10 20 30 40 re f\n"
	const stream =
		options.filter === "flate"
			? deflateSync(content)
			: new TextEncoder().encode(content)
	const filter =
		options.filter === "flate"
			? "/Filter/FlateDecode"
			: options.filter === "unsupported"
				? "/Filter/LZWDecode"
				: ""
	return joinBytes([
		`%PDF-${options.version ?? "1.4"}\n% Adobe Illustrator fixture\n`,
		"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
		"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
		`3 0 obj<</Type/Page/Parent 2 0 R/ArtBox[${options.pageBox ?? "10 20 110 220"}]/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n`,
		`4 0 obj<</Length ${stream.byteLength}${filter}>>stream\n`,
		stream,
		"\nendstream\nendobj\n",
		"5 0 obj<</Producer(Adobe Illustrator)/Title(Fixture)>>endobj\n%%EOF\n",
	])
}
