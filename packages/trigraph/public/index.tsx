import { EditorApplicationRoot } from "@trigraph/editor"
import { render } from "preact"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

render(<EditorApplicationRoot />, mount)
