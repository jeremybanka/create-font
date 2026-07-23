import { resolvedCmyk, resolvedRgb } from "./color.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignPoint,
	DesignSwatch,
} from "./types.ts"

const number = (value: number): string => Number(value.toFixed(4)).toString()

function pdfPoint(
	point: Readonly<{ x: number; y: number }>,
	pageHeight: number,
): string {
	return `${number(point.x)} ${number(pageHeight - point.y)}`
}

function segment(
	from: DesignPoint,
	to: DesignPoint,
	pageHeight: number,
): string {
	if (from.outgoing === undefined && to.incoming === undefined) {
		return `${pdfPoint(to, pageHeight)} l`
	}
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	return [
		pdfPoint({ x: from.x + first.x, y: from.y + first.y }, pageHeight),
		pdfPoint({ x: to.x + second.x, y: to.y + second.y }, pageHeight),
		pdfPoint(to, pageHeight),
		"c",
	].join(" ")
}

function contourCommands(
	contour: DesignContour,
	pageHeight: number,
): readonly string[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const commands = [`${pdfPoint(first, pageHeight)} m`]
	for (let index = 1; index < contour.points.length; index += 1) {
		const previous = contour.points[index - 1]
		const point = contour.points[index]
		if (previous !== undefined && point !== undefined) {
			commands.push(segment(previous, point, pageHeight))
		}
	}
	if (contour.closed && contour.points.length > 1) {
		const last = contour.points.at(-1)
		if (last !== undefined) commands.push(segment(last, first, pageHeight))
		commands.push("h")
	}
	return commands
}

function fillOperator(swatch: DesignSwatch): string {
	if (swatch.source.space === "cmyk") {
		const { c, m, y, k } = resolvedCmyk(swatch)
		return `${number(c / 100)} ${number(m / 100)} ${number(y / 100)} ${number(k / 100)} k`
	}
	const { r, g, b } = resolvedRgb(swatch)
	return `${number(r / 255)} ${number(g / 255)} ${number(b / 255)} rg`
}

export function pdfContentStream(document: DesignDocument): string {
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const commands = ["q"]
	for (const object of document.objects) {
		if (object.hidden) continue
		const swatch = swatches.get(object.fillId)
		if (swatch === undefined) continue
		commands.push(fillOperator(swatch))
		for (const contour of object.contours) {
			commands.push(...contourCommands(contour, document.page.height))
		}
		commands.push("f*")
	}
	commands.push("Q")
	return commands.join("\n")
}

function pdfString(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("(", "\\(")
		.replaceAll(")", "\\)")
		.replace(/[^\x20-\x7e]/g, "?")
}

/**
 * Produces a compact, dependency-free, single-page PDF 1.4 file. Each fill
 * remains in its authored RGB or CMYK space instead of being rasterized.
 */
export function exportPdf(document: DesignDocument): Uint8Array {
	const content = pdfContentStream(document)
	const width = number(document.page.width)
	const height = number(document.page.height)
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
		`<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`,
		`<< /Title (${pdfString(document.title)}) /Creator (create-design) >>`,
	]
	const chunks = ["%PDF-1.4\n%create-design\n"]
	const offsets = [0]
	let byteLength = new TextEncoder().encode(chunks[0] ?? "").byteLength
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(byteLength)
		const chunk = `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
		chunks.push(chunk)
		byteLength += new TextEncoder().encode(chunk).byteLength
	}
	const xrefOffset = byteLength
	const xref = [
		"xref",
		`0 ${objects.length + 1}`,
		"0000000000 65535 f ",
		...offsets
			.slice(1)
			.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
		"trailer",
		`<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>`,
		"startxref",
		String(xrefOffset),
		"%%EOF",
		"",
	].join("\n")
	chunks.push(xref)
	return new TextEncoder().encode(chunks.join(""))
}

export function downloadPdf(document: DesignDocument): void {
	const blob = new Blob([exportPdf(document) as BlobPart], {
		type: "application/pdf",
	})
	const url = URL.createObjectURL(blob)
	const anchor = window.document.createElement("a")
	anchor.href = url
	anchor.download = `${document.title.trim() || "untitled"}.pdf`
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
