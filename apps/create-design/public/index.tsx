import { mountDesignEditor } from "@create-design/editor/browser"
import {
	connectDesignSourceSession,
	readDesignWorkspace,
	resolveDesignWorkspaceProjectId,
} from "../src/source-sync.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const workspace = await readDesignWorkspace().catch(() => undefined)
let generation = 0
const requestedProjectId = new URL(window.location.href).searchParams.get(
	"design",
)
const initialProjectId =
	workspace === undefined
		? undefined
		: resolveDesignWorkspaceProjectId(workspace, requestedProjectId)
if (
	workspace !== undefined &&
	requestedProjectId !== null &&
	requestedProjectId !== initialProjectId
) {
	const url = new URL(window.location.href)
	url.searchParams.set("design", initialProjectId!)
	window.history.replaceState({ design: initialProjectId }, "", url)
}
let session =
	workspace === undefined
		? undefined
		: await connectDesignSourceSession({
				workspace,
				...(initialProjectId === undefined
					? {}
					: { projectId: initialProjectId }),
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
	if (workspace === undefined) return
	const resolvedProjectId = resolveDesignWorkspaceProjectId(
		workspace,
		projectId,
	)
	if (session?.projectId === resolvedProjectId) {
		if (historyMode === "none" && resolvedProjectId !== projectId) {
			const url = new URL(window.location.href)
			url.searchParams.set("design", resolvedProjectId)
			window.history.replaceState({ design: resolvedProjectId }, "", url)
		}
		return
	}
	const request = ++generation
	const next = await connectDesignSourceSession({
		workspace,
		projectId: resolvedProjectId,
	}).catch(() => undefined)
	if (request !== generation) {
		next?.dispose?.()
		return
	}
	if (next === undefined) return
	const previous = session
	session = next
	if (historyMode === "push") {
		const url = new URL(window.location.href)
		url.searchParams.set("design", resolvedProjectId)
		window.history.pushState({ design: resolvedProjectId }, "", url)
	} else if (resolvedProjectId !== projectId) {
		const url = new URL(window.location.href)
		url.searchParams.set("design", resolvedProjectId)
		window.history.replaceState({ design: resolvedProjectId }, "", url)
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
