import { describe, expect, it } from "vitest"
import {
	emptyThread,
	parseRevisionFromBlobName,
	THREAD_SCHEMA_VERSION,
	type Thread,
	threadBlobName,
	threadBlobPrefix,
	unscopedBlobName,
} from "../src/guide/util/thread-store"

describe("threadBlobPrefix", () => {
	it("returns a stable prefix for an id", () => {
		expect(threadBlobPrefix("demo")).toBe("agent-thread/demo/")
	})

	it("sanitizes characters that aren't safe in blob names", () => {
		expect(threadBlobPrefix("user@example.com")).toBe(
			"agent-thread/user_example_com/",
		)
	})

	it("keeps hyphens and underscores intact", () => {
		expect(threadBlobPrefix("user_42-prod")).toBe(
			"agent-thread/user_42-prod/",
		)
	})
})

describe("threadBlobName", () => {
	it("encodes revision with zero-padded suffix", () => {
		expect(threadBlobName("demo", 1)).toBe("agent-thread/demo/r000001.json")
	})

	it("is deterministic for the same (id, revision)", () => {
		expect(threadBlobName("demo", 5)).toBe(threadBlobName("demo", 5))
	})

	it("sorts lexicographically in revision order up to 999999", () => {
		const names = [3, 1, 27, 2].map((r) => threadBlobName("demo", r))
		expect([...names].sort()).toEqual([
			"agent-thread/demo/r000001.json",
			"agent-thread/demo/r000002.json",
			"agent-thread/demo/r000003.json",
			"agent-thread/demo/r000027.json",
		])
	})

	it("uses the sanitized prefix for unsafe ids", () => {
		expect(threadBlobName("user@x.com", 1)).toBe(
			"agent-thread/user_x_com/r000001.json",
		)
	})
})

describe("parseRevisionFromBlobName", () => {
	it("extracts the revision", () => {
		expect(
			parseRevisionFromBlobName("agent-thread/demo/r000042.json"),
		).toBe(42)
	})

	it("handles large revision numbers beyond the padding width", () => {
		expect(
			parseRevisionFromBlobName("agent-thread/demo/r1234567.json"),
		).toBe(1234567)
	})

	it("returns null on unrelated names", () => {
		expect(parseRevisionFromBlobName("whitepaper.pdf")).toBeNull()
		expect(
			parseRevisionFromBlobName("agent-thread/demo/notes.txt"),
		).toBeNull()
		expect(parseRevisionFromBlobName("r000001.json")).toBeNull()
	})
})

describe("unscopedBlobName", () => {
	it("removes Shelby account scope prefixes from listed blob names", () => {
		expect(unscopedBlobName("@0xabc/agent-thread/demo/r000001.json")).toBe(
			"agent-thread/demo/r000001.json",
		)
	})

	it("leaves plain blob names unchanged", () => {
		expect(unscopedBlobName("agent-thread/demo/r000001.json")).toBe(
			"agent-thread/demo/r000001.json",
		)
	})
})

describe("emptyThread", () => {
	it("starts at revision 0", () => {
		expect(emptyThread("demo").revision).toBe(0)
	})

	it("starts with no turns", () => {
		expect(emptyThread("demo").turns).toEqual([])
	})

	it("tags the current schema version", () => {
		expect(emptyThread("demo").schemaVersion).toBe(THREAD_SCHEMA_VERSION)
	})

	it("carries the requested thread id", () => {
		expect(emptyThread("session-99").threadId).toBe("session-99")
	})

	it("sets createdAtMs and updatedAtMs to the same instant", () => {
		const t = emptyThread("demo")
		expect(t.createdAtMs).toBe(t.updatedAtMs)
	})
})

describe("Thread JSON round-trip", () => {
	it("preserves every field through stringify + parse", () => {
		const original: Thread = {
			schemaVersion: THREAD_SCHEMA_VERSION,
			threadId: "demo",
			revision: 3,
			createdAtMs: 1700000000000,
			updatedAtMs: 1700000010000,
			turns: [
				{
					role: "user",
					content: "hello",
					timestampMs: 1700000001000,
				},
				{
					role: "agent",
					content: "hi there",
					timestampMs: 1700000002000,
				},
			],
		}
		const roundTripped = JSON.parse(JSON.stringify(original)) as Thread
		expect(roundTripped).toEqual(original)
	})
})
