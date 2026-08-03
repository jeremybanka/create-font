import type { PartitionContoursProgress } from "@create-art/vector-geometry"

import type {
	DesignPathCommandContext,
	DesignPathCommandResult,
} from "./path-commands.ts"

export const DESIGN_PARTITION_PATHFINDER_COMMANDS = [
	"pathfinder-crop",
	"pathfinder-divide",
	"pathfinder-merge",
	"pathfinder-outline",
	"pathfinder-trim",
] as const

export type DesignPartitionPathfinderCommand =
	(typeof DESIGN_PARTITION_PATHFINDER_COMMANDS)[number]

export function isDesignPartitionPathfinderCommand(
	command: string,
): command is DesignPartitionPathfinderCommand {
	return (DESIGN_PARTITION_PATHFINDER_COMMANDS as readonly string[]).includes(
		command,
	)
}

export type PathfinderWorkerRequest = Readonly<{
	command: DesignPartitionPathfinderCommand
	context: DesignPathCommandContext
	id: number
	idSeed: string
	pathfinderTolerance?: number
}>

export type PathfinderWorkerProgress = PartitionContoursProgress &
	Readonly<{
		phase: "materializing" | "partitioning"
	}>

export type PathfinderWorkerResponse = Readonly<
	| {
			id: number
			kind: "progress"
			progress: PathfinderWorkerProgress
	  }
	| {
			error: string
			id: number
			kind: "failed"
	  }
	| {
			id: number
			kind: "result"
			result: DesignPathCommandResult
	  }
>
