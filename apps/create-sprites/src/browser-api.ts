import type { SpriteProject } from "./model.ts"

export interface SpriteSourceSession {
	readonly save: (project: SpriteProject) => Promise<void>
}

export interface SpriteEditorBrowserOptions {
	readonly initialProject: SpriteProject
	readonly sourceSession?: SpriteSourceSession
}

export interface MountedSpriteEditor {
	readonly update: (options: SpriteEditorBrowserOptions) => void
	readonly unmount: () => void
}
