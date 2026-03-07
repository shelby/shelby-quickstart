import { describe, expect, it } from "vitest"
import truncate from "./truncate"

describe("truncate", () => {
    it("truncates a standard hex address to first and last 4 chars", () => {
        const address = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"
        expect(truncate(address)).toBe("0xAbCd...Ef12")
    })

    it("handles a minimal-length address that still matches the regex", () => {
        // 0x + 4 chars + at least 1 middle char + 4 chars = 13 hex chars minimum
        const address = "0xAAAAxBBBB"
        expect(truncate(address)).toBe("0xAAAA...BBBB")
    })

    it("returns the original string when it does not start with 0x", () => {
        expect(truncate("not-a-hex-address")).toBe("not-a-hex-address")
    })

    it("returns the original string when it is too short to match", () => {
        expect(truncate("0xAB")).toBe("0xAB")
    })

    it("returns an empty string unchanged", () => {
        expect(truncate("")).toBe("")
    })

    it("handles a full 64-char Aptos address", () => {
        const address =
            "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
        expect(truncate(address)).toBe("0x1a2b...1a2b")
    })
})
