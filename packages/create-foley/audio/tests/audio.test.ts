import { describe, expect, it } from "vitest"

import { createInitialFoleyProject } from "@create-foley/source"
import { encodeWav, renderFoleyProject } from "../src/index.ts"

describe("create-foley audio", () => {
	it("renders deterministic finite stereo PCM", () => {
		const project = createInitialFoleyProject()
		const first = renderFoleyProject(project)
		const second = renderFoleyProject(project)
		expect(first.left).toEqual(second.left)
		expect(first.left).toHaveLength(Math.round(project.duration * project.sampleRate))
		expect(first.peak).toBeGreaterThan(0)
		expect(first.peak).toBeLessThanOrEqual(1)
	})

	it("encodes a 24-bit stereo WAV", () => {
		const audio = renderFoleyProject(createInitialFoleyProject())
		const wav = encodeWav(audio)
		expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF")
		expect(new DataView(wav.buffer).getUint16(34, true)).toBe(24)
		expect(wav.byteLength).toBe(44 + audio.left.length * 6)
	})
})
