import fs from "node:fs"
import path from "node:path"
import { createPrompt, useKeypress, useState } from "@inquirer/core"
import chalk from "chalk"

/**
 * Existing inquirer prompt plugins didn't seem to support my vision,
 * so we hacked together a custom one here. Apologies for the mess.
 */

const PAGE_SIZE = 20

function getDirTree(dirPath: string): string[] {
	return fs
		.readdirSync(dirPath)
		.filter((name) => !name.startsWith("."))
		.map((name) => path.join(dirPath, name))
}

type Entry = {
	label: string
	path: string
	isDir: boolean
	isUp?: boolean
}

function buildEntries(currentDir: string, fsRoot: string): Entry[] {
	const entries = getDirTree(currentDir)
		.map((p) => ({
			label: path.basename(p) + (fs.statSync(p).isDirectory() ? "/" : ""),
			path: p,
			isDir: fs.statSync(p).isDirectory(),
		}))
		.sort((a, b) => {
			if (a.isDir && !b.isDir) return -1
			if (!a.isDir && b.isDir) return 1
			return a.label.localeCompare(b.label)
		})

	return [
		...(currentDir !== fsRoot
			? [
					{
						label: ".. (up)",
						path: ".." as const,
						isDir: true,
						isUp: true,
					},
				]
			: []),
		...entries,
	]
}

export async function navigateFileTree(rootDir: string): Promise<string> {
	const fsRoot = path.parse(rootDir).root

	const fileTreePrompt = createPrompt<string, { rootDir: string }>(
		(config, done) => {
			const [state, setState] = useState(() => ({
				currentDir: config.rootDir,
				entries: buildEntries(config.rootDir, fsRoot),
				cursor: 0,
				viewOffset: 0,
			}))

			useKeypress((key) => {
				const total = state.entries.length
				if (total === 0) return
				if (key.name === "up") {
					let newCursor = state.cursor - 1
					if (newCursor < 0) newCursor = total - 1
					let newView = state.viewOffset
					if (newCursor < state.viewOffset) {
						newView = newCursor
					} else if (newCursor === total - 1 && total > PAGE_SIZE) {
						newView = Math.max(0, total - PAGE_SIZE)
					}
					setState({
						...state,
						cursor: newCursor,
						viewOffset: newView,
					})
				} else if (key.name === "down") {
					let newCursor = state.cursor + 1
					if (newCursor >= total) newCursor = 0
					let newView = state.viewOffset
					if (newCursor >= state.viewOffset + PAGE_SIZE) {
						newView = newCursor - PAGE_SIZE + 1
					} else if (newCursor === 0) {
						newView = 0
					}
					setState({
						...state,
						cursor: newCursor,
						viewOffset: newView,
					})
				} else if (key.name === "pageup") {
					const newView = Math.max(0, state.viewOffset - PAGE_SIZE)
					const newCursor = Math.max(
						newView,
						state.cursor - PAGE_SIZE,
					)
					setState({
						...state,
						cursor: newCursor,
						viewOffset: newView,
					})
				} else if (key.name === "pagedown") {
					const newView = Math.min(
						Math.max(0, total - PAGE_SIZE),
						state.viewOffset + PAGE_SIZE,
					)
					const newCursor = Math.min(
						newView + PAGE_SIZE - 1,
						state.cursor + PAGE_SIZE,
						total - 1,
					)
					setState({
						...state,
						cursor: newCursor,
						viewOffset: newView,
					})
				} else if (key.name === "home") {
					setState({ ...state, cursor: 0, viewOffset: 0 })
				} else if (key.name === "end") {
					const newCursor = total - 1
					setState({
						...state,
						cursor: newCursor,
						viewOffset: Math.max(0, total - PAGE_SIZE),
					})
				} else if (key.name === "return") {
					const entry = state.entries[state.cursor]
					if (!entry) return
					if (entry.path === "..") {
						const parentDir = path.dirname(state.currentDir)
						const nextDir =
							parentDir === state.currentDir
								? state.currentDir
								: parentDir
						const entries = buildEntries(nextDir, fsRoot)
						setState({
							currentDir: nextDir,
							entries,
							cursor: 0,
							viewOffset: 0,
						})
						return
					}
					if (entry.isDir) {
						const nextDir = entry.path as string
						const entries = buildEntries(nextDir, fsRoot)
						setState({
							currentDir: nextDir,
							entries,
							cursor: 0,
							viewOffset: 0,
						})
						return
					}
					// File selected
					done(entry.path as string)
				} else if (key.name === "c" && key.ctrl) {
					process.exit(1)
				}
			})
			const header = `${chalk.gray("Current directory:")} ${chalk.cyan(state.currentDir)}`

			const total = state.entries.length
			const start = state.viewOffset
			const endExclusive = Math.min(total, start + PAGE_SIZE)
			const visible = state.entries.slice(start, endExclusive)

			const list = visible
				.map((e, i) => {
					const absoluteIndex = start + i
					const pointer =
						absoluteIndex === state.cursor ? chalk.cyan("›") : " "
					const name =
						absoluteIndex === state.cursor
							? chalk.cyan(e.label)
							: e.label
					return `${pointer} ${name}`
				})
				.join("\n")

			const rangeInfo = chalk.dim(
				`Showing ${start + 1}-${endExclusive} of ${total}`,
			)
			const scrollHint =
				total > PAGE_SIZE
					? chalk.dim("PgUp/PgDn/Home/End for fast scroll")
					: ""
			const help = chalk.white(
				chalk.cyan("↑/↓"),
				"move",
				chalk.whiteBright("|"),
				chalk.cyan("Enter"),
				"open/select",
				chalk.whiteBright("|"),
				chalk.cyan("Ctrl+C"),
				"abort",
			)

			return `\n${header}\n\n${list}\n\n${rangeInfo}${scrollHint ? `  ${scrollHint}` : ""}\n${help}\n`
		},
	)

	return await fileTreePrompt({ rootDir })
}
