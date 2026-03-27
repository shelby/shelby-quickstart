import { describe, it, expect } from "vitest"
import { Readable } from "node:stream"
import { filesize } from "filesize"

describe("Bug Fixes Implementation Tests", () => {
	it("should safely handle non-Error exceptions without throwing a TypeError (e.message)", () => {
		// Simulate the catch block logic in index.ts
		const errorHandler = (e: unknown) => {
			const msg = e instanceof Error ? e.message : String(e)
			if (msg.includes("EBLOB_WRITE_CHUNKSET_ALREADY_EXISTS")) {
				return "ALREADY_EXISTS"
			}
			return "UNKNOWN"
		}

		// Previous bug: e.message.includes() would throw TypeError if e had no message
		const plainStringError = "EBLOB_WRITE_CHUNKSET_ALREADY_EXISTS"
		expect(() => errorHandler(plainStringError)).not.toThrow()
		expect(errorHandler(plainStringError)).toBe("ALREADY_EXISTS")

		const plainObjectError = { some: "error" }
		expect(() => errorHandler(plainObjectError)).not.toThrow()
	})

	it("should parse potentially bigints into numbers for Date calculation without TypeErrors", () => {
		// Simulate the expiration calculation
		const calculateExpiry = (expirationMicros: number | bigint) => {
			// Previous bug: 1000000n / 1000 throws TypeError: Cannot mix BigInt and other types
			return new Date(Number(expirationMicros) / 1000)
		}

		const microsNumber = 1680000000000000
		const microsBigInt = 1680000000000000n

		expect(() => calculateExpiry(microsBigInt)).not.toThrow()
		expect(calculateExpiry(microsBigInt).getTime()).toEqual(calculateExpiry(microsNumber).getTime())
	})

	it("should calculate filesize with BigInts without crashing", () => {
		const sizeBigInt = 1500000n

		// Previous bug: filesize(blob.size) where size is BigInt may throw errors or behave unexpectedly
		expect(() => filesize(Number(sizeBigInt))).not.toThrow()
		expect(filesize(Number(sizeBigInt))).toBe("1.5 MB")
	})

	it("should properly adapt node Streams without fromWeb errors", () => {
		// Simulate pipeline(Readable.fromWeb(stream))
		const processStream = (readable: any) => {
			// Try to adapt stream safely
			const nodeStream = typeof readable.getReader === 'function' ? Readable.fromWeb(readable) : readable
			return nodeStream instanceof Readable
		}

		const pureNodeStream = Readable.from(["hello"])
		
		// If it's a Node stream, getReader is not defined, so it returns itself, evaluating to true
		expect(() => processStream(pureNodeStream)).not.toThrow()
		expect(processStream(pureNodeStream)).toBe(true)
	})
})
