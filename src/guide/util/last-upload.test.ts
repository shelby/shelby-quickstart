import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLastUpload, setLastUpload } from "./last-upload"

let tempDir: string

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "shelby-test-"))
	vi.spyOn(process, "cwd").mockReturnValue(tempDir)
})

afterEach(() => {
	vi.restoreAllMocks()
	try {
		rmSync(tempDir, { recursive: true })
	} catch {
		// Cleanup may fail on Windows — non-critical
	}
})

describe("setLastUpload", () => {
	it("returns null on successful write", () => {
		const result = setLastUpload("my-blob.pdf")
		expect(result).toBeNull()
	})
})

describe("getLastUpload", () => {
	it("returns null when no upload has been recorded", () => {
		expect(getLastUpload()).toBeNull()
	})

	it("returns the blob name after a successful set", () => {
		setLastUpload("whitepaper.pdf")
		expect(getLastUpload()).toBe("whitepaper.pdf")
	})

	it("returns the most recent blob name after multiple sets", () => {
		setLastUpload("first-blob.txt")
		setLastUpload("second-blob.png")
		expect(getLastUpload()).toBe("second-blob.png")
	})
})
