import type { Contour, Cubic, Point } from "../src/index.ts"

export const outerSquare: Contour = {
	closed: true,
	points: [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 100 },
		{ x: 0, y: 100 },
	],
}

export const squareHole: Contour = {
	closed: true,
	points: [
		{ x: 25, y: 25 },
		{ x: 25, y: 75 },
		{ x: 75, y: 75 },
		{ x: 75, y: 25 },
	],
}

export const tangentSegments = {
	first: [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	] satisfies readonly Point[],
	second: [
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
	] satisfies readonly Point[],
}

export const overlappingSegments = {
	first: [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	] satisfies readonly Point[],
	second: [
		{ x: 4, y: 0 },
		{ x: 12, y: 0 },
	] satisfies readonly Point[],
}

export const bowTie: Contour = {
	closed: true,
	points: [
		{ x: 0, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
		{ x: 10, y: 0 },
	],
}

export const tinySegmentContour: Contour = {
	closed: true,
	points: [
		{ x: 0, y: 0 },
		{ x: 1e-10, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	],
}

export const largeCoordinateContour: Contour = {
	closed: true,
	points: [
		{ x: 1_000_000_000_000, y: 1_000_000_000_000 },
		{ x: 1_000_000_000_100, y: 1_000_000_000_000 },
		{ x: 1_000_000_000_100, y: 1_000_000_000_100 },
		{ x: 1_000_000_000_000, y: 1_000_000_000_100 },
	],
}

export const archCubic: Cubic = {
	p0: { x: 0, y: 0 },
	c1: { x: 0, y: 100 },
	c2: { x: 100, y: 100 },
	p3: { x: 100, y: 0 },
}
