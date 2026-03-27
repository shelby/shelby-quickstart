import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import chalk from "chalk"
import { parse } from "yaml"
import { cliDocsUrl } from "../../../config.json"
import { cmd, url } from "./format"
import type { ShelbyConfig } from "./types"

const docsUrl = url(cliDocsUrl)

export default function envCheck(configPath: string): ShelbyConfig {
	let config: ShelbyConfig
	try {
		const shellCmd = process.platform === "win32" ? "where shelby" : "which shelby"
		execSync(shellCmd, { stdio: "ignore" })
	} catch {
		console.error(
			chalk.bold.whiteBright(
				"Shelby CLI not found in PATH. Please install the Shelby CLI\n See:",
			),
			docsUrl,
		)
		process.exit(1)
	}

	if (!existsSync(configPath)) {
		console.error(
			chalk.bold.whiteBright(
				`Shelby CLI config not found. Please run ${cmd("shelby init")} to initialize Shelby CLI.\n See:`,
			),
			docsUrl,
		)
		process.exit(1)
	}

	try {
		const file = readFileSync(configPath, "utf8")
		config = parse(file)
	} catch (_err) {
		console.error(
			chalk.bold.whiteBright(
				`Shelby CLI config file ${url("~/.shelby/config.yaml")} is invalid.\nPlease fix, or delete the file and run ${cmd("shelby init")} again.\n See:`,
			),
			docsUrl,
		)
		process.exit(1)
	}
	return config
}
