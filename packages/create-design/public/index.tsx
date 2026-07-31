import { render } from "preact"

import { DesignApplication } from "../src/DesignApplication.tsx"
import { migrateDesignTilingStorage } from "../src/design-tile-registry.ts"
import { connectDesignSourceSession } from "../src/source-sync.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const session = await connectDesignSourceSession().catch(() => undefined)

try {
	migrateDesignTilingStorage(localStorage)
} catch {
	// Layout persistence is best-effort in restricted browser contexts.
}

render(
	session === undefined ? (
		<DesignApplication />
	) : (
		<DesignApplication
			initialDocument={session.initialDocument}
			sourceSession={session}
		/>
	),
	mount,
)
