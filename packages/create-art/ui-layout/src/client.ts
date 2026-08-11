import type {
	SaveUiLayoutInput,
	UiLayoutError,
	UiLayoutsResponse,
} from "./contracts.ts"

async function responseJson<T>(response: Response): Promise<T> {
	const value = (await response.json()) as T | UiLayoutError
	if (!response.ok)
		throw new Error(
			(value as UiLayoutError).message ||
				`UI layout request failed (${response.status}).`,
		)
	return value as T
}

export function createUiLayoutClient(base = "") {
	return {
		load: (product: SaveUiLayoutInput["product"]): Promise<UiLayoutsResponse> =>
			fetch(
				`${base}/api/ui-layouts?product=${encodeURIComponent(product)}`,
			).then(responseJson<UiLayoutsResponse>),
		save: (input: SaveUiLayoutInput): Promise<UiLayoutsResponse> =>
			fetch(`${base}/api/ui-layouts`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			}).then(responseJson<UiLayoutsResponse>),
	}
}
