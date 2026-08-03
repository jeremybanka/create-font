import { useO } from "atom.io/react"

import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./FontNavigator.module.css"

export interface FontNavigatorProps {
	readonly workspace: EditorWorkspace
}

export function FontNavigator({ workspace }: FontNavigatorProps) {
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const masterIds = useO(workspace.font.atoms.masterIds)
	const instanceIds = useO(workspace.font.atoms.instanceIds)

	return (
		<font-navigator className={css.class}>
			<nav aria-label="Font navigation">
				<navigation-section>
					<section-heading>
						<span>Masters</span>
						<data value={masterIds.length}>{masterIds.length}</data>
					</section-heading>
					<ul>
						{masterIds.map((masterId) => (
							<MasterNavigationItem
								key={masterId}
								workspace={workspace}
								masterId={masterId}
								active={masterId === activeMasterId}
							/>
						))}
					</ul>
				</navigation-section>

				<navigation-section>
					<section-heading>
						<span>Instances</span>
						<data value={instanceIds.length}>{instanceIds.length}</data>
					</section-heading>
					<ul>
						{instanceIds.map((instanceId) => (
							<InstanceNavigationItem
								key={instanceId}
								workspace={workspace}
								instanceId={instanceId}
							/>
						))}
					</ul>
				</navigation-section>
			</nav>
		</font-navigator>
	)
}

function MasterNavigationItem({
	workspace,
	masterId,
	active,
}: {
	readonly workspace: EditorWorkspace
	readonly masterId: Parameters<EditorWorkspace["actions"]["selectMaster"]>[0]
	readonly active: boolean
}) {
	const master = useO(workspace.font.selectors.editorMasterSource, masterId)
	return (
		<master-navigation-item>
			{master === null ? null : (
				<li>
					<button
						type="button"
						aria-pressed={active}
						onClick={() => workspace.actions.selectMaster(masterId)}
					>
						<master-swatch data-master={master.kind} />
						<span>{master.name}</span>
						<small>{master.kind === "default" ? "Default" : "Source"}</small>
					</button>
				</li>
			)}
		</master-navigation-item>
	)
}

function InstanceNavigationItem({
	workspace,
	instanceId,
}: {
	readonly workspace: EditorWorkspace
	readonly instanceId: Parameters<
		EditorWorkspace["actions"]["selectInstance"]
	>[0]
}) {
	const instance = useO(
		workspace.font.selectors.editorInstanceSource,
		instanceId,
	)
	const location = useO(workspace.ui.previewLocation)
	const axes = useO(workspace.font.selectors.editorAxesSource) ?? []
	const coordinates = instance?.coordinates ?? {}
	const isActive = axes.every(
		(axis) =>
			(coordinates[axis.id] ?? axis.default) ===
			(location[axis.id] ?? axis.default),
	)
	const locationLabel = axes
		.map((axis) => coordinates[axis.id] ?? axis.default)
		.join("/")
	return (
		<instance-navigation-item>
			{instance === null ? null : (
				<li>
					<button
						type="button"
						aria-pressed={isActive}
						onClick={() => workspace.actions.selectInstance(instanceId)}
					>
						<instance-mark />
						<span>{instance.name}</span>
						<small>{locationLabel}</small>
					</button>
				</li>
			)}
		</instance-navigation-item>
	)
}
