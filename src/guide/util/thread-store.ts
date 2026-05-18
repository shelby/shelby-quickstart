import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"
import type { Account, AccountAddress } from "@aptos-labs/ts-sdk"
import type { ShelbyNodeClient } from "@shelby-protocol/sdk/node"

/**
 * Bump this if the on-disk shape of `Thread` ever changes. Readers can then
 * decide whether to migrate or ignore old threads instead of crashing.
 */
export const THREAD_SCHEMA_VERSION = 1

export type ThreadRole = "user" | "agent" | "system"

export interface ThreadTurn {
	role: ThreadRole
	content: string
	timestampMs: number
}

export interface Thread {
	/** Schema version of the on-disk thread shape. */
	schemaVersion: number
	/** Caller-provided thread id. The same id resumes the same conversation. */
	threadId: string
	/**
	 * Monotonically increasing save number, starting at 1. Each save writes a
	 * fresh blob whose name encodes this number, so every save is independently
	 * addressable and "resume" just needs to find the highest revision.
	 */
	revision: number
	createdAtMs: number
	updatedAtMs: number
	turns: ThreadTurn[]
}

export function emptyThread(threadId: string): Thread {
	const now = Date.now()
	return {
		schemaVersion: THREAD_SCHEMA_VERSION,
		threadId,
		revision: 0,
		createdAtMs: now,
		updatedAtMs: now,
		turns: [],
	}
}

/**
 * Prefix used by all blobs that belong to a single thread.
 */
export function threadBlobPrefix(threadId: string): string {
	const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_")
	return `agent-thread/${safe}/`
}

/**
 * Deterministic blob name for one revision of a thread.
 *
 * Each save writes to a new name, which keeps every revision independently
 * addressable on Shelby. The "current" thread is whichever revision is
 * largest among the account's blobs under `threadBlobPrefix(threadId)`.
 */
export function threadBlobName(threadId: string, revision: number): string {
	const padded = String(revision).padStart(6, "0")
	return `${threadBlobPrefix(threadId)}r${padded}.json`
}

/**
 * `getAccountBlobs` may return display names scoped as
 * `@account/blob-name`. Download APIs still expect the original blob name.
 */
export function unscopedBlobName(name: string): string {
	return name.replace(/^@[^/]+\//, "")
}

/**
 * Extract the revision number from a thread blob name, or null if the name
 * doesn't match the expected shape. Robust against unexpected entries under
 * the prefix.
 */
export function parseRevisionFromBlobName(name: string): number | null {
	const m = name.match(/\/r(\d+)\.json$/)
	if (!m) return null
	const n = Number.parseInt(m[1], 10)
	return Number.isFinite(n) ? n : null
}

async function streamToString(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of Readable.fromWeb(stream)) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks).toString("utf8")
}

function parseThread(raw: string, blobName: string): Thread {
	const parsed = JSON.parse(raw) as Thread
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray(parsed.turns)
	) {
		throw new Error(
			`Thread blob ${blobName} is malformed (missing turns array).`,
		)
	}
	return parsed
}

/**
 * Find the most recent revision of a thread for this account, or `null` if
 * the thread doesn't exist yet.
 *
 * "Not found" is a normal first-run state, not an error — the caller decides
 * whether to start a fresh thread or refuse to continue. Anything else
 * (network, decode, schema) is rethrown so the caller can surface it.
 */
export async function loadLatestThread(opts: {
	client: ShelbyNodeClient
	account: AccountAddress
	threadId: string
}): Promise<Thread | null> {
	const { client, account, threadId } = opts
	const prefix = threadBlobPrefix(threadId)
	const all = await client.coordination.getAccountBlobs({ account })
	let latestName: string | null = null
	let latestRev = -1
	for (const blob of all) {
		const name = unscopedBlobName(blob.name)
		if (!name.startsWith(prefix)) continue
		const rev = parseRevisionFromBlobName(name)
		if (rev === null) continue
		if (rev > latestRev) {
			latestRev = rev
			latestName = name
		}
	}
	if (latestName === null) {
		return null
	}
	const blob = await client.download({ account, blobName: latestName })
	const webStream = blob.readable as ReadableStream<Uint8Array>
	const raw = await streamToString(webStream)
	return parseThread(raw, latestName)
}

/**
 * Persist a new revision of a thread.
 *
 * Each call writes a fresh blob named for the next revision number; previous
 * revisions remain until they expire, which is useful for audit and replay.
 * If you want strict cleanup, list the prefix and let older revisions age out
 * by setting a shorter expiration on them.
 */
export async function saveThread(opts: {
	client: ShelbyNodeClient
	signer: Account
	thread: Thread
	expirationMicros: number
}): Promise<{ thread: Thread; blobName: string }> {
	const { client, signer, thread, expirationMicros } = opts
	const nextRevision = thread.revision + 1
	const nextThread: Thread = {
		...thread,
		revision: nextRevision,
		updatedAtMs: Date.now(),
	}
	const blobName = threadBlobName(thread.threadId, nextRevision)
	const payload = Buffer.from(JSON.stringify(nextThread), "utf8")
	await client.upload({
		blobData: payload,
		signer,
		blobName,
		expirationMicros,
	})
	return { thread: nextThread, blobName }
}
