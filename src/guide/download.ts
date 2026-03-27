import "dotenv/config"
import { createWriteStream, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream } from "node:stream/web"
import { AccountAddress, Network } from "@aptos-labs/ts-sdk"
import { input } from "@inquirer/prompts"
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node"
import chalk from "chalk"
import { filesize } from "filesize"
import ora from "ora"
import { apiKeyDocsUrl, defaultApiKey } from "../../config.json"
import { cmd, url } from "./util/format"
import { getLastUpload } from "./util/last-upload"
import truncate from "./util/truncate"

const SHELBY_ACCOUNT_ADDRESS = process.env.SHELBY_ACCOUNT_ADDRESS
const SHELBY_API_KEY = process.env.SHELBY_API_KEY

if (!SHELBY_ACCOUNT_ADDRESS) {
	console.error("SHELBY_ACCOUNT_ADDRESS is not set in", chalk.cyan(".env"))
	process.exit(1)
}
if (!SHELBY_API_KEY) {
	console.error("SHELBY_API_KEY is not set in", chalk.cyan(".env"))
	process.exit(1)
}

const client = new ShelbyNodeClient({
	network: Network.SHELBYNET,
	apiKey: SHELBY_API_KEY,
})

async function main() {
	const spinner = ora()
	try {
		const lastUpload = getLastUpload()
		const blobName = await input({
			message: "What is the name of the blob you would like to download?",
			default: lastUpload || undefined,
		})
		if (!blobName) {
			console.error(
				chalk.bold.whiteBright("No blob name provided. Exiting."),
			)
			process.exit(1)
		}
		const accountStr: string = SHELBY_ACCOUNT_ADDRESS as string
		const account = AccountAddress.fromString(accountStr)
		const outPath = join(process.cwd(), "downloads", blobName)
		mkdirSync(dirname(outPath), { recursive: true })

		spinner.text = chalk.bold.whiteBright(
			"Downloading",
			`${chalk.cyan(truncate(accountStr))}/${chalk.cyan(blobName)}`,
			"from Shelby...",
		)
		spinner.start()
		/**
		 * Retrieve the blob from Shelby
		 */
		const blob = await client.download({ account, blobName })

		spinner.text = chalk.bold.whiteBright(
			"Saving",
			chalk.cyan(blobName),
			"to",
			`${chalk.cyan(outPath)}...`,
		)
		const stream: any = blob.readable
		const nodeStream = typeof stream.getReader === 'function' ? Readable.fromWeb(stream) : stream as NodeJS.ReadableStream
		
		/**
		 * Pipe the blob's ReadableStream to our Node WriteStream
		 */
		await pipeline(nodeStream, createWriteStream(outPath))
		spinner.stop()
		console.log(
			chalk.green("✔"),
			chalk.bold.whiteBright(
				"Blob",
				`${chalk.cyan(account.toString())}/${chalk.cyan(blobName)}`,
				"downloaded successfully!\n",
			),
		)
		console.log(chalk.bold.whiteBright("Saved to:"), chalk.cyan(outPath))
		if (blob.contentLength) {
			console.log(
				chalk.bold.whiteBright("Blob size:"),
				chalk.yellow(filesize(Number(blob.contentLength))),
			)
		}
		console.log("\n")
		console.log(
			chalk.bold.whiteBright(
				"Congratulations! You know how to use Shelby!\n",
			),
		)
		console.log(
			chalk.bold.whiteBright(
				"Next: take a look at the code in",
				chalk.cyan("src/index.ts"),
				"to get started with your own integration.\n",
			),
		)
	} catch (e: unknown) {
		spinner.stop()
		if (e instanceof Error && e.name === "ExitPromptError") {
			console.error(
				chalk.bold.whiteBright("Download canceled. No files written."),
			)
			process.exit(1)
		}
		const msg = e instanceof Error ? e.message : String(e)
		if (/not\s*found|404/i.test(msg)) {
			console.error(
				chalk.bold.whiteBright(
					"Blob not found. Did storage expire?\n",
					"\nUse",
					cmd("npm run list"),
					"to see your current blobs or",
					cmd("npm run upload"),
					"to upload a new one.\n",
				),
			)
			process.exit(1)
		}
		if (e instanceof Error && e.message.includes("429")) {
			console.error(chalk.bold.redBright("Rate limit exceeded (429)."))
			if (SHELBY_API_KEY === defaultApiKey) {
				console.error(
					chalk.bold.whiteBright(
						"\nYou're using the default API key, which is subject to strict rate limits.",
						"\nYou can get your own API key for free! More info:",
						url(apiKeyDocsUrl),
					),
				)
			}
			return
		}
		if (/500|internal server error/i.test(msg)) {
			console.error(
				chalk.bold.redBright(
					"A server error occurred (500). Please try again later or contact support.",
				),
			)
			process.exit(1)
		}
		console.error(chalk.bold.whiteBright("Unexpected error:\n", msg))
		process.exit(1)
	}
}

main()
