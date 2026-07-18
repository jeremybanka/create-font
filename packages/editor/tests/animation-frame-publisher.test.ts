import { describe, expect, it } from "vitest"

import {
	createAnimationFramePublisher,
	type AnimationFrameSource,
} from "../src/animation-frame-publisher.ts"

function controlledFrames() {
	let nextFrame = 1
	const callbacks = new Map<number, () => void>()
	const source: AnimationFrameSource = {
		request(callback) {
			const frame = nextFrame
			nextFrame += 1
			callbacks.set(frame, callback)
			return frame
		},
		cancel(frame) {
			callbacks.delete(frame)
		},
	}
	return {
		source,
		get pendingCount() {
			return callbacks.size
		},
		publishFrame() {
			const entry = callbacks.entries().next().value
			if (entry === undefined) return
			const [frame, callback] = entry
			callbacks.delete(frame)
			callback()
		},
	}
}

describe("animation-frame publisher", () => {
	it("publishes one latest-value update for a burst within a frame", () => {
		const frames = controlledFrames()
		const published: Readonly<{
			x: number
			y: number
			shiftKey: boolean
			altKey: boolean
		}>[] = []
		const publisher = createAnimationFramePublisher(
			(value) => published.push(value),
			frames.source,
		)

		publisher.schedule({ x: 10, y: 20, shiftKey: false, altKey: false })
		publisher.schedule({ x: 30, y: 40, shiftKey: true, altKey: false })
		publisher.schedule({ x: 50, y: 60, shiftKey: false, altKey: true })

		expect(frames.pendingCount).toBe(1)
		expect(published).toEqual([])
		frames.publishFrame()
		expect(published).toEqual([{ x: 50, y: 60, shiftKey: false, altKey: true }])

		publisher.schedule({ x: 70, y: 80, shiftKey: true, altKey: true })
		frames.publishFrame()
		expect(published.at(-1)).toEqual({
			x: 70,
			y: 80,
			shiftKey: true,
			altKey: true,
		})
	})

	it("consumes the latest raw value without publishing a pending preview", () => {
		const frames = controlledFrames()
		const published: string[] = []
		const publisher = createAnimationFramePublisher(
			(value: string) => published.push(value),
			frames.source,
		)

		publisher.schedule("pointer move")
		publisher.schedule("pointer up")

		expect(publisher.consume()).toBe("pointer up")
		expect(frames.pendingCount).toBe(0)
		frames.publishFrame()
		expect(published).toEqual([])
		expect(publisher.consume()).toBeNull()
	})

	it("drops scheduled work across each cancellation lifecycle", () => {
		for (const lifecycle of [
			"escape",
			"pointercancel",
			"lostpointercapture",
			"tool change",
			"blur",
			"unmount",
		]) {
			const frames = controlledFrames()
			const published: string[] = []
			const publisher = createAnimationFramePublisher(
				(value: string) => published.push(value),
				frames.source,
			)

			publisher.schedule(lifecycle)
			publisher.cancel()
			frames.publishFrame()

			expect(published, lifecycle).toEqual([])
			expect(frames.pendingCount, lifecycle).toBe(0)
		}
	})
})
