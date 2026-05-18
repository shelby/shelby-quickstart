import "dotenv/config"
import {
	Account,
	AccountAddress,
	type AptosApiError,
	Ed25519PrivateKey,
	Network,
} from "@aptos-labs/ts-sdk"
import { input } from "@inquirer/prompts"
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node"
import chalk from "chalk"
import ora from "ora"
import {
	apiKeyDocsUrl,
	aptFaucetUrl,
	defaultApiKey,
	shelbyFaucetUrl,
	shelbyTicker,
} from "../../config.json"
import { cmd, url } from "./util/format"
import {
	emptyThread,
	loadLatestThread,
	saveThread,
	type Thread,
	type ThreadTurn,
} from "./util/thread-store"
import truncate from "./util/truncate"

const SHELBY_ACCOUNT_ADDRESS = process.env.SHELBY_ACCOUNT_ADDRESS
const SHELBY_ACCOUNT_PRIVATE_KEY = process.env.SHELBY_ACCOUNT_PRIVATE_KEY
const SHELBY_API_KEY = process.env.SHELBY_API_KEY

if (!SHELBY_ACCOUNT_ADDRESS || !SHELBY_ACCOUNT_PRIVATE_KEY || !SHELBY_API_KEY) {
	console.error(
		chalk.red(
			"Error: Environment variables are not fully set in .env file.",
		),
	)
	process.exit(1)
}

/**
 * Default thread storage lifetime. Tune this to your application: an agent
 * that resumes daily can use a short window, a long-running assistant can use
 * weeks or months.
 */
const THREAD_TTL_MICROS = 24 * 60 * 60 * 1_000_000 // 1 day

const client = new ShelbyNodeClient({
	network: Network.SHELBYNET,
	apiKey: SHELBY_API_KEY,
})

const signer = Account.fromPrivateKey({
	privateKey: new Ed25519PrivateKey(SHELBY_ACCOUNT_PRIVATE_KEY),
})

const account = AccountAddress.fromString(SHELBY_ACCOUNT_ADDRESS)

/**
 * Stand-in for a real LLM call. Replace this with your provider of choice
 * (OpenAI, Anthropic, a local model, or anything that returns a string given
 * the conversation so far).
 *
 * The point of this sample is the memory pattern, not the model — keeping the
 * "model" deterministic makes the demo reproducible and avoids requiring an
 * extra API key just to read the guide.
 */
function respond(thread: Thread, userMessage: string): string {
	const turnCount = thread.turns.length + 1
	const firstUserTurn = thread.turns.find((t) => t.role === "user")
	if (firstUserTurn && turnCount > 1) {
		return `Continuing our conversation (turn ${turnCount}). You first said: "${firstUserTurn.content}". Now you said: "${userMessage}".`
	}
	return `Hello. This is the first turn in our conversation. You said: "${userMessage}".`
}

function printThread(thread: Thread): void {
	if (thread.turns.length === 0) {
		console.log(chalk.dim("  (no prior turns)\n"))
		return
	}
	for (const turn of thread.turns) {
		const label =
			turn.role === "user"
				? chalk.bold.cyan("user")
				: chalk.bold.magenta("agent")
		console.log(`  ${label}: ${turn.content}`)
	}
	console.log()
}

async function main() {
	const spinner = ora()
	try {
		console.log(
			chalk.bold.whiteBright(
				"\nWelcome to the Shelby AI Agent Memory sample.",
			),
		)
		console.log(
			chalk.dim(
				"This sample stores conversation threads as Shelby blobs so an agent can",
			),
		)
		console.log(
			chalk.dim(
				"resume the same conversation across processes, regions, and restarts.\n",
			),
		)

		const threadId = await input({
			message: "Thread id (re-use the same id to resume a conversation):",
			default: "demo",
		})

		spinner.text = chalk.bold.whiteBright(
			"Looking up latest revision for thread",
			chalk.cyan(threadId),
			"on",
			`${chalk.cyan(truncate(SHELBY_ACCOUNT_ADDRESS as string))}...`,
		)
		spinner.start()

		const existing = await loadLatestThread({ client, account, threadId })
		spinner.stop()

		const thread: Thread = existing ?? emptyThread(threadId)

		if (existing) {
			console.log(
				chalk.green("✔"),
				chalk.bold.whiteBright(
					`Resumed at revision ${existing.revision} with ${existing.turns.length} prior turn(s):\n`,
				),
			)
		} else {
			console.log(
				chalk.bold.whiteBright(
					"Starting a fresh thread.",
					chalk.dim(
						"\n  Run this sample again with the same thread id to resume it.\n",
					),
				),
			)
		}
		printThread(thread)

		const userMessage = await input({
			message: "Your message to the agent:",
			default: "What did I tell you last time?",
		})

		const agentReply = respond(thread, userMessage)

		const now = Date.now()
		const userTurn: ThreadTurn = {
			role: "user",
			content: userMessage,
			timestampMs: now,
		}
		const agentTurn: ThreadTurn = {
			role: "agent",
			content: agentReply,
			timestampMs: now,
		}

		const withNewTurns: Thread = {
			...thread,
			turns: [...thread.turns, userTurn, agentTurn],
		}

		console.log(
			chalk.bold.whiteBright("\nAgent reply:"),
			chalk.magenta(agentReply),
			"\n",
		)

		spinner.text = chalk.bold.whiteBright(
			"Persisting next revision to Shelby...",
		)
		spinner.start()

		const { thread: saved, blobName } = await saveThread({
			client,
			signer,
			thread: withNewTurns,
			expirationMicros: Date.now() * 1000 + THREAD_TTL_MICROS,
		})

		spinner.stop()
		console.log(
			chalk.green("✔"),
			chalk.bold.whiteBright(
				`Saved revision ${saved.revision} as ${chalk.cyan(blobName)} (${saved.turns.length} turn(s)).\n`,
			),
		)

		console.log(
			chalk.bold.whiteBright(
				"Next: run",
				cmd("npm run agent"),
				`again with thread id ${chalk.cyan(`"${threadId}"`)} to resume,`,
				"\nor",
				cmd("npm run list"),
				"to see the revision blobs alongside any other blobs you've uploaded.\n",
			),
		)
	} catch (e: unknown) {
		spinner.stop()
		if (e instanceof Error && e.name === "ExitPromptError") {
			console.error(chalk.bold.whiteBright("Agent session canceled."))
			process.exit(1)
		}

		const msg = e instanceof Error ? e.message : String(e)

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

		if (msg.includes("E_INSUFFICIENT_FUNDS")) {
			console.log(
				chalk.bold.whiteBright(
					"You don't have enough",
					chalk.cyan(shelbyTicker),
					"to save the thread. Visit the faucet:\n",
					url(`${shelbyFaucetUrl}?address=${SHELBY_ACCOUNT_ADDRESS}`),
				),
			)
			return
		}

		if (msg.includes("429")) {
			console.error(chalk.bold.redBright("Rate limit exceeded (429)."))
			if (SHELBY_API_KEY === defaultApiKey) {
				console.error(
					chalk.bold.whiteBright(
						"\nYou're using the default API key with strict rate limits. Get your own:",
						url(apiKeyDocsUrl),
					),
				)
			}
			return
		}

		const aptosErr = e as AptosApiError
		console.error(chalk.red("Unexpected error:"), aptosErr.message ?? msg)
		process.exit(1)
	}
}

main()
