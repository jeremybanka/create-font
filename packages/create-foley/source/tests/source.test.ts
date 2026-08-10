import { describe, expect, it } from "vitest"

import {
	assembleFoleyProject,
	createInitialFoleyProject,
	splitFoleyProject,
	validateFoleyProject,
} from "../src/index.ts"

describe("create-foley source", () => {
	it("round-trips a project through source units", () => {
		const project = createInitialFoleyProject("Door slam")
		expect(assembleFoleyProject(splitFoleyProject(project))).toEqual(project)
	})

	it("rejects duplicate layer IDs", () => {
		const project = createInitialFoleyProject()
		expect(() =>
			validateFoleyProject({ ...project, layers: [project.layers[0], project.layers[0]] }),
		).toThrow(/Duplicate layer ID/u)
	})
})
