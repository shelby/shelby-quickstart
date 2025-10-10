import chalk from "chalk"
import {
	aptFaucetUrl,
	cliDocsUrl,
	shelbyFaucetUrl,
	shelbyTicker,
} from "../../config.json"
import accountConfig from "./util/account-config"
import contextConfig from "./util/context-config"
import envCheck from "./util/env-check"
import { cmd, url } from "./util/format"
import writeFile from "./util/write-file"

const shelbyCLIDocsUrl = url(cliDocsUrl)
const configPath = `${process.env.HOME}/.shelby/config.yaml`

const config = envCheck(configPath)

try {
	const accountSettings = await accountConfig(config)
	if (!accountSettings) {
		console.log(
			chalk.bold.whiteBright(
				`No accounts found in: ${chalk.cyan(
					configPath,
				)}\nPlease run ${cmd("shelby account create")} and try again.\n See: ${shelbyCLIDocsUrl}`,
			),
		)
		process.exit(1)
	}
	const contextSettings = await contextConfig(config)
	if (!contextSettings) {
		console.error(
			`No contexts found in Shelby config. Please create one with ${cmd("shelby context create")} or use default settings.\n See: ${url(cliDocsUrl)}`,
		)
		process.exit(1)
	}
	const writeError = writeFile({ ...accountSettings, ...contextSettings })
	if (!writeError) {
		// FIXME: Assuming the user is always on shelbynet at this point
		console.log(
			chalk.bold.whiteBright(
				"Created",
				chalk.cyan(".env"),
				"file with selected account settings. Next:",
				"\n\n1) Ensure your account is funded...\n",
				chalk.cyan(shelbyTicker),
				"faucet:",
				chalk.cyan(
					`${shelbyFaucetUrl}?address=${accountSettings.address}\n`,
				),
				chalk.cyan("APT"),
				"faucet:",
				chalk.cyan(
					`${aptFaucetUrl}?address=${accountSettings.address}`,
				),
				"\n\n2) Then use",
				cmd("npm run upload"),
				"to upload a few blobs to Shelby.\n",
			),
		)
	} else {
		console.log(
			chalk.bold.whiteBright(
				"An error occurred while writing the",
				chalk.cyan(".env"),
				"file:",
			),
		)
		console.log(writeError)
	}
} catch (e) {
	if (e instanceof Error && e.name === "ExitPromptError") {
		console.error(
			chalk.bold.whiteBright("Configuration canceled. No file written."),
		)
	} else {
		console.error("Unexpected error:", e)
		console.error("---")
		console.error(chalk.bold.whiteBright("Please report this issue."))
	}
	process.exit(1)
}
