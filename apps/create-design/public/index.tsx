import { mountDesignEditor } from "@create-design/editor/browser"
import { connectDesignSourceSession } from "../src/source-sync.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const session = await connectDesignSourceSession().catch(() => undefined)

mountDesignEditor(
	mount,
	session === undefined
		? {}
		: { initialDocument: session.initialDocument, sourceSession: session },
)
