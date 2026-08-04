const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function uint32(value: number): Uint8Array {
	return new Uint8Array([
		(value >>> 24) & 255,
		(value >>> 16) & 255,
		(value >>> 8) & 255,
		value & 255,
	])
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let index = 0; index < 256; index += 1) {
		let value = index
		for (let bit = 0; bit < 8; bit += 1)
			value = (value & 1) === 0 ? value >>> 1 : 0xedb88320 ^ (value >>> 1)
		table[index] = value >>> 0
	}
	return table
})()

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff
	for (const byte of bytes)
		value = CRC_TABLE[(value ^ byte) & 255]! ^ (value >>> 8)
	return (value ^ 0xffffffff) >>> 0
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(
		parts.reduce((sum, part) => sum + part.length, 0),
	)
	let offset = 0
	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}
	return result
}

function chunk(name: string, data: Uint8Array): Uint8Array {
	const type = new TextEncoder().encode(name)
	return concatenate([
		uint32(data.length),
		type,
		data,
		uint32(crc32(concatenate([type, data]))),
	])
}

function adler32(bytes: Uint8Array): number {
	let a = 1
	let b = 0
	for (const byte of bytes) {
		a = (a + byte) % 65521
		b = (b + a) % 65521
	}
	return ((b << 16) | a) >>> 0
}

/** Deterministic zlib stream using stored DEFLATE blocks (no runtime codec). */
function deflateStored(bytes: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
	for (let offset = 0; offset < bytes.length || offset === 0; offset += 65535) {
		const length = Math.min(65535, bytes.length - offset)
		const final = offset + length >= bytes.length
		parts.push(
			new Uint8Array([
				final ? 1 : 0,
				length & 255,
				(length >>> 8) & 255,
				~length & 255,
				(~length >>> 8) & 255,
			]),
			bytes.subarray(offset, offset + length),
		)
		if (final) break
	}
	parts.push(uint32(adler32(bytes)))
	return concatenate(parts)
}

/** Encodes canonical 8-bit non-interlaced RGBA with no ancillary metadata. */
export function encodeRgbaPng(
	width: number,
	height: number,
	rgba: Uint8Array,
): Uint8Array {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1
	)
		throw new Error("PNG dimensions must be positive safe integers.")
	if (rgba.length !== width * height * 4)
		throw new Error("RGBA byte length does not match PNG dimensions.")
	const scanlines = new Uint8Array(height * (width * 4 + 1))
	for (let row = 0; row < height; row += 1) {
		const target = row * (width * 4 + 1)
		scanlines[target] = 0
		scanlines.set(
			rgba.subarray(row * width * 4, (row + 1) * width * 4),
			target + 1,
		)
	}
	const ihdr = new Uint8Array(13)
	ihdr.set(uint32(width), 0)
	ihdr.set(uint32(height), 4)
	ihdr.set([8, 6, 0, 0, 0], 8)
	return concatenate([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateStored(scanlines)),
		chunk("IEND", new Uint8Array()),
	])
}
