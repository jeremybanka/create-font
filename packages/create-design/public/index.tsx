import { render } from "preact"

import { DesignApplication } from "../src/DesignApplication.tsx"
import "../src/design.css"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

render(<DesignApplication />, mount)
