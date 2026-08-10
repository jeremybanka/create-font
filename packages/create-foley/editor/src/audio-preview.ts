import type { RenderedFoleyAudio } from "@create-foley/audio"

export type AudioPreview = Readonly<{
	play: (audio: RenderedFoleyAudio, offset: number, loop: boolean) => Promise<void>
	stop: () => void
}>

export function createAudioPreview(onEnded: () => void): AudioPreview {
	let context: AudioContext | undefined
	let source: AudioBufferSourceNode | undefined
	return {
		async play(audio, offset, loop) {
			context ??= new AudioContext()
			await context.resume()
			source?.stop()
			const buffer = context.createBuffer(2, audio.left.length, audio.sampleRate)
			buffer.getChannelData(0).set(audio.left)
			buffer.getChannelData(1).set(audio.right)
			source = context.createBufferSource()
			source.buffer = buffer
			source.loop = loop
			source.connect(context.destination)
			source.onended = onEnded
			source.start(0, Math.min(offset, Math.max(0, audio.duration - 0.001)))
		},
		stop() {
			if (source === undefined) return
			source.onended = null
			source.stop()
			source.disconnect()
			source = undefined
		},
	}
}
