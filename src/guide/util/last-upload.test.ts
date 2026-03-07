import { unlinkSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getLastUpload, setLastUpload } from "./last-upload"

const filePath = join(process.cwd(), ".last_upload")

afterEach(() => {
    try {
        unlinkSync(filePath)
    } catch {
        // File may not exist
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
        // Ensure file does not exist before test
        try {
            unlinkSync(filePath)
        } catch {
            // ignore
        }
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
