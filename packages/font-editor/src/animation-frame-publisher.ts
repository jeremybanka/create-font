export interface AnimationFrameSource {
	readonly request: (callback: () => void) => number
	readonly cancel: (frame: number) => void
}

export interface AnimationFramePublisher<Value> {
	readonly schedule: (value: Value) => void
	readonly consume: () => Value | null
	readonly cancel: () => void
}

const browserAnimationFrames: AnimationFrameSource = {
	request: (callback) => requestAnimationFrame(callback),
	cancel: (frame) => cancelAnimationFrame(frame),
}

/**
 * Retains the latest raw value while publishing at most once per animation frame.
 * `consume` is for terminal events that need the newest value without first
 * publishing a now-obsolete preview.
 */
export function createAnimationFramePublisher<Value>(
	publish: (value: Value) => void,
	frames: AnimationFrameSource = browserAnimationFrames,
): AnimationFramePublisher<Value> {
	let pending: Value | null = null
	let frame: number | null = null

	const cancelFrame = (): void => {
		if (frame === null) return
		frames.cancel(frame)
		frame = null
	}

	return {
		schedule(value) {
			pending = value
			if (frame !== null) return
			frame = frames.request(() => {
				frame = null
				const latest = pending
				pending = null
				if (latest !== null) publish(latest)
			})
		},
		consume() {
			cancelFrame()
			const latest = pending
			pending = null
			return latest
		},
		cancel() {
			cancelFrame()
			pending = null
		},
	}
}
