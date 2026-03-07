import { readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { EnvVariables } from "./types"
import writeFile from "./write-file"

const envPath = join(process.cwd(), ".env")

const mockSettings: EnvVariables = {
    account_name: "test-account",
    address: "0xTEST_ADDRESS",
    private_key: "0xTEST_PRIVATE_KEY",
    context_name: "test-context",
    api_key: "AG-TEST_API_KEY",
    network: {
        name: "shelbynet",
        fullnode: "https://fullnode.example.com",
        faucet: "https://faucet.example.com",
        indexer: "https://indexer.example.com",
        pepper: "https://pepper.example.com",
        prover: "https://prover.example.com",
    },
}

afterEach(() => {
    try {
        unlinkSync(envPath)
    } catch {
        // File may not exist if test failed before writing
    }
})

describe("writeFile", () => {
    it("returns null on successful write", () => {
        const result = writeFile(mockSettings)
        expect(result).toBeNull()
    })

    it("writes all expected environment variables", () => {
        writeFile(mockSettings)
        const content = readFileSync(envPath, "utf8")

        expect(content).toContain("SHELBY_ACCOUNT_NAME=test-account")
        expect(content).toContain("SHELBY_ACCOUNT_ADDRESS=0xTEST_ADDRESS")
        expect(content).toContain(
            "SHELBY_ACCOUNT_PRIVATE_KEY=0xTEST_PRIVATE_KEY",
        )
        expect(content).toContain("SHELBY_CONTEXT_NAME=test-context")
        expect(content).toContain("SHELBY_API_KEY=AG-TEST_API_KEY")
        expect(content).toContain("SHELBY_NETWORK_NAME=shelbynet")
        expect(content).toContain(
            "SHELBY_FULLNODE=https://fullnode.example.com",
        )
        expect(content).toContain("SHELBY_FAUCET=https://faucet.example.com")
        expect(content).toContain(
            "SHELBY_INDEXER=https://indexer.example.com",
        )
        expect(content).toContain("SHELBY_PEPPER=https://pepper.example.com")
        expect(content).toContain("SHELBY_PROVER=https://prover.example.com")
    })

    it("writes exactly 11 lines (one per env variable)", () => {
        writeFile(mockSettings)
        const content = readFileSync(envPath, "utf8")
        const lines = content.split("\n").filter(Boolean)
        expect(lines).toHaveLength(11)
    })
})
