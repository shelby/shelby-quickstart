import { confirm, input } from "@inquirer/prompts"
import { apiKeyDocsUrl, defaultApiKey } from "../../../config.json"
import { url } from "./format"

export default async function apiConfig(): Promise<{ api_key: string }> {
	const noApiKey = await confirm({
		message: "Would you like to use the default API key for now?",
		default: true,
	})
	if (noApiKey) {
		// FIXME: Add link to the docs about obtaining an API key
		console.log(
			"\nPlease consider obtaining an API key after completing this quickstart guide.",
			"\nFor more information on API keys, please see:",
			url(apiKeyDocsUrl),
			"\n",
		)
		return { api_key: defaultApiKey }
	}
	const apiKey = await input({
		message: "Please enter your API key:",
		validate: (value) =>
			value.trim().length > 0
				? true
				: "Please enter an API key or choose the default key.",
	})
	return { api_key: apiKey.trim() }
}
