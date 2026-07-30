import { render } from "preact"

import { DesignApplication } from "../src/DesignApplication.tsx"
import { connectDesignSourceSession } from "../src/source-sync.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const session = await connectDesignSourceSession().catch(() => undefined)

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
