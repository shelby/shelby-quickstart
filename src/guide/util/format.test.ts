import { describe, expect, it } from "vitest"
import { cmd, url } from "./format"

describe("cmd", () => {
    it("wraps the command text so it is present in the output", () => {
        const result = cmd("npm run build")
        expect(result).toContain("npm run build")
    })

    it("pads the command with surrounding spaces", () => {
        const result = cmd("shelby init")
        // chalk.bgMagenta.black(` ${command} `) adds a space on each side
        expect(result).toContain(" shelby init ")
    })
})

describe("url", () => {
    it("returns output containing the original URL string", () => {
        const result = url("https://docs.shelby.xyz/tools/cli")
        expect(result).toContain("https://docs.shelby.xyz/tools/cli")
    })
})
