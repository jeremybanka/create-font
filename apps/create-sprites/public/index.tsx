import { mountSpriteEditor } from "../src/browser.ts"
import { createSpriteProject, normalizeSpriteProject, type SpriteProject } from "../src/model.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error(`Missing #app mount element.`)

let initialProject: SpriteProject
let connected = false
try {
	const response = await fetch("/api/project")
	if (!response.ok) throw new Error(`Source server returned ${response.status}.`)
	initialProject = normalizeSpriteProject(await response.json())
	connected = true
} catch {
	const recovery = localStorage.getItem("create-sprites:recovery:v1")
	try {
		initialProject = recovery === null ? createSpriteProject() : normalizeSpriteProject(JSON.parse(recovery))
	} catch {
		initialProject = createSpriteProject()
	}
}

mountSpriteEditor(mount, {
	initialProject,
	...(connected
		? {
			sourceSession: {
				async save(project) {
					const response = await fetch("/api/project", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(project),
					})
					if (!response.ok) {
						const payload = await response.json().catch(() => ({})) as { error?: string }
						throw new Error(payload.error ?? `Source server returned ${response.status}.`)
					}
				},
			},
		}
		: {}),
})
