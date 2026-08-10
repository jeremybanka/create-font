import type { FoleyLayer, FoleyProject } from "@create-foley/source"
import { validateFoleyProject } from "@create-foley/source"

export type RenderedFoleyAudio = Readonly<{
	left: Float32Array
	right: Float32Array
	sampleRate: number
	duration: number
	peak: number
	rms: number
}>

export type WavBitDepth = 16 | 24

function randomGenerator(seedInput: number): () => number {
	let seed = seedInput || 0x6d2b_79f5
	return () => {
		seed = (seed + 0x6d2b_79f5) >>> 0
		let value = seed
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
	}
}

function oscillator(waveform: FoleyLayer["waveform"], phase: number): number {
	const turn = phase - Math.floor(phase)
	switch (waveform) {
		case "triangle":
			return 1 - 4 * Math.abs(turn - 0.5)
		case "square":
			return turn < 0.5 ? 1 : -1
		case "sawtooth":
			return 2 * turn - 1
		default:
			return Math.sin(turn * Math.PI * 2)
	}
}

function envelopeAt(layer: FoleyLayer, time: number): number {
	const { attack, decay, sustain, release } = layer.envelope
	if (time < 0 || time >= layer.duration) return 0
	if (attack > 0 && time < attack) return time / attack
	if (decay > 0 && time < attack + decay)
		return 1 - (1 - sustain) * ((time - attack) / decay)
	const releaseStart = Math.max(attack + decay, layer.duration - release)
	if (release > 0 && time >= releaseStart)
		return sustain * Math.max(0, (layer.duration - time) / release)
	return sustain
}

function generateLayerSample(
	layer: FoleyLayer,
	time: number,
	random: () => number,
): number {
	const phase = time / layer.duration
	const white = random() * 2 - 1
	switch (layer.generator) {
		case "impact": {
			const bodyFrequency = layer.pitch * (1.9 - 1.2 * phase)
			const body = Math.sin(Math.PI * 2 * bodyFrequency * time) * Math.exp(-7 * phase)
			const transient = white * Math.exp(-30 * phase)
			return transient * 0.78 + body * 0.72
		}
		case "whoosh": {
			const movement = Math.sin(Math.PI * Math.min(1, phase))
			const flutter = 0.82 + 0.18 * Math.sin(time * 17 + layer.seed)
			return white * movement * flutter
		}
		case "crackle": {
			const density = 0.018 + 0.08 * Math.exp(-5 * phase)
			return random() < density ? white * (0.5 + random() * 0.5) : white * 0.015
		}
		case "tone": {
			const frequency = layer.pitch * (1 - 0.08 * phase)
			return oscillator(layer.waveform, frequency * time)
		}
		case "noise":
		default:
			return white
	}
}

function filteredLayer(layer: FoleyLayer, sampleRate: number): Float32Array {
	const length = Math.max(1, Math.round(layer.duration * sampleRate))
	const output = new Float32Array(length)
	const random = randomGenerator(layer.seed)
	const lowCut = Math.min(layer.filter.lowpass, sampleRate * 0.48)
	const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowCut) / sampleRate)
	const highCut = Math.min(layer.filter.highpass, sampleRate * 0.45)
	const highAlpha = Math.exp((-2 * Math.PI * highCut) / sampleRate)
	let lowState = 0
	let highState = 0
	let previousLowInput = 0
	for (let index = 0; index < length; index += 1) {
		const time = index / sampleRate
		const generated = generateLayerSample(layer, time, random)
		lowState += lowAlpha * (generated - lowState)
		highState = highAlpha * (highState + lowState - previousLowInput)
		previousLowInput = lowState
		output[index] = highState * envelopeAt(layer, time) * layer.gain
	}
	return output
}

function applyLoopCrossfade(
	channel: Float32Array,
	sampleRate: number,
	seconds: number,
): void {
	const count = Math.min(
		Math.floor(channel.length / 2),
		Math.round(seconds * sampleRate),
	)
	if (count < 2) return
	const head = channel.slice(0, count)
	for (let index = 0; index < count; index += 1) {
		const mix = index / (count - 1)
		const tailIndex = channel.length - count + index
		channel[tailIndex] = channel[tailIndex] * (1 - mix) + head[index]! * mix
	}
}

export function renderFoleyProject(projectInput: FoleyProject): RenderedFoleyAudio {
	const project = validateFoleyProject(projectInput)
	const length = Math.max(1, Math.round(project.duration * project.sampleRate))
	const left = new Float32Array(length)
	const right = new Float32Array(length)
	const anySolo = project.layers.some((layer) => layer.solo && !layer.muted)
	for (const layer of project.layers) {
		if (layer.muted || (anySolo && !layer.solo)) continue
		const samples = filteredLayer(layer, project.sampleRate)
		const offset = Math.round(layer.start * project.sampleRate)
		const leftPan = Math.cos(((layer.pan + 1) * Math.PI) / 4)
		const rightPan = Math.sin(((layer.pan + 1) * Math.PI) / 4)
		for (let index = 0; index < samples.length && offset + index < length; index += 1) {
			const value = samples[index]!
			left[offset + index] += value * leftPan
			right[offset + index] += value * rightPan
		}
	}
	if (project.looping && project.loopCrossfade > 0) {
		applyLoopCrossfade(left, project.sampleRate, project.loopCrossfade)
		applyLoopCrossfade(right, project.sampleRate, project.loopCrossfade)
	}
	let peak = 0
	let sumSquares = 0
	for (let index = 0; index < length; index += 1) {
		const rawLeft = left[index]! * project.masterGain
		const rawRight = right[index]! * project.masterGain
		const finalLeft = Math.tanh(rawLeft)
		const finalRight = Math.tanh(rawRight)
		left[index] = finalLeft
		right[index] = finalRight
		peak = Math.max(peak, Math.abs(finalLeft), Math.abs(finalRight))
		sumSquares += finalLeft * finalLeft + finalRight * finalRight
	}
	return {
		left,
		right,
		sampleRate: project.sampleRate,
		duration: project.duration,
		peak,
		rms: Math.sqrt(sumSquares / (length * 2)),
	}
}

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1)
		view.setUint8(offset + index, value.charCodeAt(index))
}

export function encodeWav(
	audio: RenderedFoleyAudio,
	bitDepth: WavBitDepth = 24,
): Uint8Array {
	const bytesPerSample = bitDepth / 8
	const dataLength = audio.left.length * 2 * bytesPerSample
	const bytes = new Uint8Array(44 + dataLength)
	const view = new DataView(bytes.buffer)
	writeAscii(view, 0, "RIFF")
	view.setUint32(4, 36 + dataLength, true)
	writeAscii(view, 8, "WAVE")
	writeAscii(view, 12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, 2, true)
	view.setUint32(24, audio.sampleRate, true)
	view.setUint32(28, audio.sampleRate * 2 * bytesPerSample, true)
	view.setUint16(32, 2 * bytesPerSample, true)
	view.setUint16(34, bitDepth, true)
	writeAscii(view, 36, "data")
	view.setUint32(40, dataLength, true)
	let offset = 44
	for (let index = 0; index < audio.left.length; index += 1) {
		for (const sample of [audio.left[index]!, audio.right[index]!]) {
			const clipped = Math.max(-1, Math.min(1, sample))
			if (bitDepth === 16) {
				view.setInt16(offset, Math.round(clipped * (clipped < 0 ? 32_768 : 32_767)), true)
				offset += 2
			} else {
				let value = Math.round(clipped * (clipped < 0 ? 8_388_608 : 8_388_607))
				if (value < 0) value += 0x1_00_00_00
				view.setUint8(offset, value & 0xff)
				view.setUint8(offset + 1, (value >>> 8) & 0xff)
				view.setUint8(offset + 2, (value >>> 16) & 0xff)
				offset += 3
			}
		}
	}
	return bytes
}

export function renderFoleyWav(
	project: FoleyProject,
	bitDepth: WavBitDepth = 24,
): Uint8Array {
	return encodeWav(renderFoleyProject(project), bitDepth)
}
