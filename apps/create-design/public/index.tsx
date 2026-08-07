import { mountDesignEditor } from "@create-design/editor/browser"
import {
	connectDesignSourceSession,
	readDesignWorkspace,
} from "../src/source-sync.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const workspace = await readDesignWorkspace().catch(() => undefined)
let generation = 0
let session =
	workspace === undefined
		? undefined
		: await connectDesignSourceSession({
				workspace,
				projectId:
					new URL(window.location.href).searchParams.get("design") ??
					workspace.activeProjectId,
			}).catch(() => undefined)

const editor = mountDesignEditor(mount, options(session))

function options(nextSession: typeof session) {
	return nextSession === undefined
		? {}
		: {
				initialDocument: nextSession.initialDocument,
				sourceSession: nextSession,
				onProjectChange: (projectId: string) => void switchProject(projectId),
			}
}

async function switchProject(
	projectId: string,
	historyMode: "push" | "none" = "push",
) {
	if (workspace === undefined || session?.projectId === projectId) return
	const request = ++generation
	const next = await connectDesignSourceSession({ workspace, projectId }).catch(
		() => undefined,
	)
	if (request !== generation) {
		next?.dispose?.()
		return
	}
	if (next === undefined) return
	const previous = session
	session = next
	if (historyMode === "push") {
		const url = new URL(window.location.href)
		url.searchParams.set("design", projectId)
		window.history.pushState({ design: projectId }, "", url)
	}
	editor.update(options(next))
	previous?.dispose?.()
}

window.addEventListener("popstate", () => {
	if (workspace === undefined) return
	const projectId =
		new URL(window.location.href).searchParams.get("design") ??
		workspace.activeProjectId
	void switchProject(projectId, "none")
})
