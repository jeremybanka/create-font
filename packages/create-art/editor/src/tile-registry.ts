import type { ComponentChild } from "preact"

import type { EditorIconName } from "./EditorIcon.tsx"
import type {
	TileColumnId,
	TileInstance,
	TilingLayout,
} from "./tiling-workspace.ts"

export interface TileDefaultPlacement {
	readonly column: TileColumnId
	readonly fill?: boolean
}

export interface TileCommandMetadata {
	readonly category?: string
	readonly description?: string
	readonly icon?: EditorIconName
	readonly shortcut?: string
}

export interface TileRenderProps<Context, Kind extends string> {
	readonly context: Context
	readonly tile: TileInstance<Kind>
}

export interface TileRegistration<Kind extends string, Context> {
	readonly kind: Kind
	readonly name: string
	readonly description: string
	readonly render: (props: TileRenderProps<Context, Kind>) => ComponentChild
	readonly available?: (context: Context) => boolean
	readonly defaultFill?: boolean
	readonly defaultPlacement?: TileDefaultPlacement
	readonly command?: false | TileCommandMetadata
}

export interface TileRegistry<Kind extends string, Context> {
	readonly registrations: readonly TileRegistration<Kind, Context>[]
	readonly byKind: ReadonlyMap<Kind, TileRegistration<Kind, Context>>
}

export type RegistryKind<Registry> = Registry extends {
	readonly registrations: readonly { readonly kind: infer Kind }[]
}
	? Extract<Kind, string>
	: never

export function createTileRegistry<
	Kind extends string,
	Context,
	const Registrations extends readonly TileRegistration<Kind, Context>[] =
		readonly TileRegistration<Kind, Context>[],
>(
	registrations: Registrations,
): TileRegistry<Registrations[number]["kind"], Context> {
	const byKind = new Map(
		registrations.map((registration) => [registration.kind, registration]),
	)
	if (byKind.size !== registrations.length) {
		throw new Error(`Tile registry kinds must be unique.`)
	}
	return { registrations, byKind }
}

export function createRegistryDefaultLayout<Kind extends string, Context>(
	registry: TileRegistry<Kind, Context>,
): TilingLayout<Kind> {
	const columns = ([1, 2, 3, 4] as const).map((id) => ({
		id,
		alignment: "top" as const,
		collapsed: false,
		tiles: registry.registrations.flatMap((registration) =>
			registration.defaultPlacement?.column === id
				? [
						{
							id: `${registration.kind}:default`,
							kind: registration.kind,
							fill:
								registration.defaultPlacement.fill ??
								registration.defaultFill ??
								false,
						},
					]
				: [],
		),
	}))
	return { version: 3, columns }
}

export function availableTileRegistrations<Kind extends string, Context>(
	registry: TileRegistry<Kind, Context>,
	context: Context,
): readonly TileRegistration<Kind, Context>[] {
	return registry.registrations.filter(
		(registration) => registration.available?.(context) !== false,
	)
}

export interface TileRegistryCommand<Kind extends string> {
	readonly id: string
	readonly displayName: string
	readonly category: string
	readonly description: string
	readonly icon: EditorIconName
	readonly shortcut?: string
	readonly kind: Kind
}

export function tileRegistryCommands<Kind extends string, Context>(
	registry: TileRegistry<Kind, Context>,
	context: Context,
): readonly TileRegistryCommand<Kind>[] {
	return availableTileRegistrations(registry, context).flatMap(
		(registration) =>
			registration.command === false
				? []
				: [
						{
							id: `workspace-tile-${registration.kind}`,
							displayName: `Open or focus ${registration.name}`,
							category: registration.command?.category ?? "Workspace",
							description:
								registration.command?.description ??
								`Open ${registration.name}, or focus its existing tile.`,
							icon: registration.command?.icon ?? "SquareIcon",
							...(registration.command?.shortcut === undefined
								? {}
								: { shortcut: registration.command.shortcut }),
							kind: registration.kind,
						},
					],
	)
}
