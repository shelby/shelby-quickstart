import "dotenv/config"
import { readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import {
	Account,
	Ed25519PrivateKey,
	Network,
} from "@aptos-labs/ts-sdk"
import { input, select } from "@inquirer/prompts"
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node"
import chalk from "chalk"
import ora from "ora"
import prettyMilliseconds from "pretty-ms"
import {
	apiKeyDocsUrl,
	aptFaucetUrl,
	defaultApiKey,
	shelbyFaucetUrl,
	shelbyTicker,
} from "../../config.json"
import { navigateFileTree } from "./util/file-tree-navigator"
import { cmd, url } from "./util/format"
import { setLastUpload } from "./util/last-upload"

const SHELBY_ACCOUNT_ADDRESS = process.env.SHELBY_ACCOUNT_ADDRESS
const SHELBY_ACCOUNT_PRIVATE_KEY = process.env.SHELBY_ACCOUNT_PRIVATE_KEY
const SHELBY_API_KEY = process.env.SHELBY_API_KEY

if (!SHELBY_ACCOUNT_ADDRESS || !SHELBY_ACCOUNT_PRIVATE_KEY || !SHELBY_API_KEY) {
	console.error(chalk.red("Error: Environment variables are not fully set in .env file."))
	process.exit(1)
}

const client = new ShelbyNodeClient({
	network: Network.SHELBYNET,
	apiKey: SHELBY_API_KEY,
})

const signer = Account.fromPrivateKey({
	privateKey: new Ed25519PrivateKey(SHELBY_ACCOUNT_PRIVATE_KEY),
})

async function main() {
	const spinner = ora()
	try {
		console.log(
			chalk.bold.whiteBright(
				"\nWelcome to the Shelby Blob Uploader!\nSelect a file to upload. Sample assets included below:",
			),
		)

		const uploadFile = await navigateFileTree(join(process.cwd(), "assets"))
		
		// Calculate file size metadata
		const fileStats = statSync(uploadFile)
		const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2)

		console.log(
			chalk.bold.whiteBright("You selected:"),
			chalk.cyan(uploadFile),
			chalk.yellow(`(${fileSizeMB} MB)`)
		)

		const blobName = await input({
			message: "What would you like to name this blob on Shelby?",
			default: basename(uploadFile),
		})

		const duration = await select({
			message: "How long should the blob be stored?",
			choices: [
				{ name: "1 minute", value: 60 * 1_000_000 },
				{ name: "1 hour", value: 60 * 60 * 1_000_000 },
				{ name: "1 day", value: 24 * 60 * 60 * 1_000_000 },
				{ name: "1 week", value: 7 * 24 * 60 * 60 * 1_000_000 },
				{ name: "1 month", value: 30 * 24 * 60 * 60 * 1_000_000 },
				{ name: "1 year", value: 365 * 24 * 60 * 60 * 1_000_000 },
			],
		})

		spinner.text = chalk.bold.whiteBright(
			`Storing ${chalk.cyan(blobName)} (${chalk.yellow(fileSizeMB + " MB")}) on Shelby...`
		)
		spinner.start()

		await client.upload({
			blobData: readFileSync(uploadFile),
			signer,
			blobName,
			expirationMicros: Date.now() * 1000 + duration,
		})

		spinner.stop()
		console.log(
			chalk.green("✔"),
			chalk.bold.whiteBright(`Uploaded ${chalk.cyan(blobName)} successfully!\n`),
		)

		setLastUpload(blobName)
		console.log(
			chalk.bold.whiteBright("Next: Use", cmd("npm run list"), "to see your uploaded blobs.\n"),
		)

	} catch (e: unknown) {
		spinner.stop()
		if (e instanceof Error && e.name === "ExitPromptError") {
			console.error(chalk.bold.whiteBright("Upload canceled."))
			process.exit(1)
		}
		
		const msg = e instanceof Error ? e.message : String(e)

		if (msg.includes("EBLOB_WRITE_CHUNKSET_ALREADY_EXISTS")) {
			console.log(chalk.yellow("This blob already exists. Try a different name."))
			return
		}

		if (msg.includes("INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE")) {
			console.log(
				chalk.bold.whiteBright(
					"You don't have enough",
					chalk.cyan("APT"),
					"to pay for the transaction fee. Visit the faucet:\n",
				),
				url(`${aptFaucetUrl}?address=${SHELBY_ACCOUNT_ADDRESS}`),
			)
			return
		}

		if (msg.includes("EBLOB_WRITE_INSUFFICIENT_FUNDS")) {
			console.log(
				chalk.bold.whiteBright(
					"You don't have enough",
					chalk.cyan(shelbyTicker),
					"to upload this blob. Visit the faucet:\n",
					url(`${shelbyFaucetUrl}?address=${SHELBY_ACCOUNT_ADDRESS}`),
				),
			)
			return
		}

		if (msg.includes("429")) {
			console.error(chalk.bold.redBright("Rate limit exceeded (429)."))
			if (SHELBY_API_KEY === defaultApiKey) {
				console.error(chalk.bold.whiteBright("\nYou're using the default API key with strict rate limits. Get your own:", url(apiKeyDocsUrl)))
			}
			return
		}

		console.error(chalk.red("Unexpected error:"), msg)
		process.exit(1)
	}
}

main()
