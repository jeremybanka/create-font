import { Circle, Group, Line, Rect, Text } from "@create-art/editor"
import type { EditorLayerNode } from "@create-font/states"

import type { EditorCollaborationSession } from "./browser-api.ts"
/* eslint-disable lasertag/render-tag-with-own-name -- This component is a Konva scene graph and must return a Konva Group rather than a DOM custom element. */
import {
	parsePresenceSelection,
	participantColor,
	presenceGlyphPosition,
	type PresenceGlyphPosition,
} from "./collaboration-presence.ts"
import { resolveSelectionControls } from "./outline-selection.ts"

export function CollaborationCanvasPresence({
	activeGlyphId,
	activeMasterId,
	ascender,
	descender,
	inverseScale,
	nodes,
	positions,
	session,
}: {
	readonly activeGlyphId: string | null
	readonly activeMasterId: string
	readonly ascender: number
	readonly descender: number
	readonly inverseScale: number
	readonly nodes: readonly EditorLayerNode[]
	readonly positions: readonly PresenceGlyphPosition[]
	readonly session: EditorCollaborationSession
}) {
	const nodeById = new Map(nodes.map((node) => [node.pointId, node]))
	const remote = session.presence.filter(
		(presence) =>
			presence.deviceId !== session.deviceId &&
			(presence.context.surface === undefined ||
				presence.context.surface === `canvas`),
	)
	return (
		<Group name="collaboration-canvas-presence" listening={false}>
			{remote.flatMap((presence, presenceIndex) => {
				const position = presenceGlyphPosition(presence, positions)
				if (position === null) return []
				const participant = session.participants.find(
					(item) => item.identity.deviceId === presence.deviceId,
				)
				const color = participantColor(presence.deviceId)
				const name = participant?.identity.name ?? `Guest`
				const zoneInset = presenceIndex * 3 * inverseScale
				const selection = parsePresenceSelection(presence.selection)
				const selectedControls =
					presence.context.glyph === activeGlyphId &&
					presence.context.master === activeMasterId
						? resolveSelectionControls(nodes, selection)
						: []
				return [
					<Group key={presence.deviceId}>
						<Rect
							name="remote-glyph-zone"
							x={position.x + zoneInset}
							y={position.baseline - ascender + zoneInset}
							width={Math.max(0, position.advance - zoneInset * 2)}
							height={Math.max(0, ascender - descender - zoneInset * 2)}
							stroke={color}
							strokeWidth={2 * inverseScale}
							dash={[7 * inverseScale, 4 * inverseScale]}
							opacity={0.72}
						/>
						<Text
							name="remote-glyph-zone-label"
							x={position.x + 5 * inverseScale}
							y={position.baseline - ascender - 17 * inverseScale}
							text={`${name} · ${presence.gesture ?? `idle`}`}
							fontSize={10 * inverseScale}
							fontStyle="bold"
							fill={color}
						/>
						{presence.selectionBox === undefined ||
						presence.selectionBox === null ? null : (
							<>
								<Rect
									name="remote-selection-box-fill"
									x={position.x + presence.selectionBox.minX}
									y={position.baseline - presence.selectionBox.maxY}
									width={
										presence.selectionBox.maxX - presence.selectionBox.minX
									}
									height={
										presence.selectionBox.maxY - presence.selectionBox.minY
									}
									fill={color}
									opacity={0.1}
								/>
								<Rect
									name="remote-selection-box"
									x={position.x + presence.selectionBox.minX}
									y={position.baseline - presence.selectionBox.maxY}
									width={
										presence.selectionBox.maxX - presence.selectionBox.minX
									}
									height={
										presence.selectionBox.maxY - presence.selectionBox.minY
									}
									stroke={color}
									strokeWidth={1.5 * inverseScale}
									dash={[5 * inverseScale, 3 * inverseScale]}
								/>
							</>
						)}
						{presence.cursor === null ? null : (
							<Group
								name="remote-cursor"
								x={position.x + presence.cursor.x}
								y={position.baseline - presence.cursor.y}
							>
								<Line
									points={[
										0,
										0,
										0,
										14 * inverseScale,
										4 * inverseScale,
										10 * inverseScale,
										8 * inverseScale,
										18 * inverseScale,
										11 * inverseScale,
										16 * inverseScale,
										7 * inverseScale,
										8 * inverseScale,
										13 * inverseScale,
										8 * inverseScale,
									]}
									closed
									fill={color}
									stroke="white"
									strokeWidth={inverseScale}
								/>
								<Text
									x={13 * inverseScale}
									y={13 * inverseScale}
									text={name}
									fontSize={10 * inverseScale}
									fontStyle="bold"
									fill={color}
								/>
							</Group>
						)}
						{selectedControls.length === 0 ? null : (
							<Group
								name="remote-outline-selection"
								x={position.x}
								y={position.baseline}
								scaleY={-1}
							>
								{selectedControls.flatMap((control) => {
									const owner = nodeById.get(control.target.pointId)
									return [
										...(control.target.kind === `handle` && owner !== undefined
											? [
													<Line
														key={`line:${presence.deviceId}:${control.target.pointId}:${control.target.handle}`}
														name="remote-selected-handle-line"
														points={[owner.x, owner.y, control.x, control.y]}
														stroke={color}
														strokeWidth={2 * inverseScale}
														opacity={0.72}
													/>,
												]
											: []),
										<Circle
											key={`control:${presence.deviceId}:${control.target.kind}:${control.target.pointId}:${control.target.kind === `handle` ? control.target.handle : `node`}`}
											name="remote-selected-control"
											x={control.x}
											y={control.y}
											radius={7 * inverseScale}
											fill={color}
											opacity={0.32}
											stroke={color}
											strokeWidth={2 * inverseScale}
										/>,
									]
								})}
							</Group>
						)}
					</Group>,
				]
			})}
		</Group>
	)
}
