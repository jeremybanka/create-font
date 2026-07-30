import type {
	SourceProjectSnapshot,
	WriteSourceUnitsInput,
	WriteSourceUnitsResult,
} from "./contracts.ts"

async function responseJson<Value>(response: Response): Promise<Value> {
	const value = (await response.json()) as Value | { message?: string }
	if (!response.ok) {
		throw new Error(
			`message` in Object(value) && typeof value.message === `string`
				? value.message
				: `Source RPC request failed with ${response.status}.`,
		)
	}
	return value as Value
}

export function createSourceRpcClient(origin = ``) {
	const base = origin.replace(/\/$/, ``)
	return {
		readSnapshot: () =>
			fetch(`${base}/api/source/snapshot`).then((response) =>
				responseJson<SourceProjectSnapshot>(response),
			),
		writeUnits: (input: WriteSourceUnitsInput) =>
			fetch(`${base}/api/source/units`, {
				body: JSON.stringify(input),
				headers: { "content-type": `application/json` },
				method: `PUT`,
			}).then((response) => responseJson<WriteSourceUnitsResult>(response)),
	}
}
