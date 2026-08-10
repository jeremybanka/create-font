import { mountFoleyEditor } from "@create-foley/editor/browser"
import { validateFoleyProject } from "@create-foley/source"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const response = await fetch("/api/project")
if (!response.ok) throw new Error(`Could not load foley source (${response.status}).`)
const initialProject = validateFoleyProject(await response.json())
document.title = `${initialProject.title} — create-foley`

mountFoleyEditor(mount, {
	initialProject,
	async onSave(project) {
		const saved = await fetch("/api/project", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(project),
		})
		if (!saved.ok) {
			const result = await saved.json() as { error?: unknown }
			throw new Error(typeof result.error === "string" ? result.error : `Save failed (${saved.status}).`)
		}
		document.title = `${project.title} — create-foley`
	},
})
