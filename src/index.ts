import "dotenv/config"
import { createWriteStream, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream } from "node:stream/web"
import {
	Account,
	AccountAddress,
	type AptosApiError,
	Ed25519PrivateKey,
	Network,
} from "@aptos-labs/ts-sdk"
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node"
import { filesize } from "filesize"

/**
 * Example blob configuration
 */
const UPLOAD_FILE = join(process.cwd(), "assets", "whitepaper.pdf")
const TIME_TO_LIVE = 60 * 60 * 1_000_000 // 1 hour
const BLOB_NAME = "whitepaper.pdf" // Name to assign the blob in Shelby

/**
 * Load & validate env vars from the .env file created by `npm run config`
 */
const SHELBY_ACCOUNT_PRIVATE_KEY = process.env.SHELBY_ACCOUNT_PRIVATE_KEY
const SHELBY_ACCOUNT_ADDRESS = process.env.SHELBY_ACCOUNT_ADDRESS as string
const SHELBY_API_KEY = process.env.SHELBY_API_KEY

if (!SHELBY_ACCOUNT_ADDRESS) {
	console.error("SHELBY_ACCOUNT_ADDRESS is not set in .env")
	process.exit(1)
}
if (!SHELBY_ACCOUNT_PRIVATE_KEY) {
	console.error("SHELBY_ACCOUNT_PRIVATE_KEY is not set in .env")
	process.exit(1)
}
if (!SHELBY_API_KEY) {
	console.error("SHELBY_API_KEY is not set in .env")
	process.exit(1)
}

/**
 * For now, Shelby only supports the shelbynet network
 * In the future, you can specify which network to use
 */
const client = new ShelbyNodeClient({
	network: Network.SHELBYNET,
	apiKey: SHELBY_API_KEY,
})

const signer = Account.fromPrivateKey({
	privateKey: new Ed25519PrivateKey(SHELBY_ACCOUNT_PRIVATE_KEY),
})
const account = AccountAddress.fromString(SHELBY_ACCOUNT_ADDRESS)

// Away we go!
async function main() {
	try {
		/**
		 * Upload the blob to Shelby
		 */
		console.log("*** Uploading", BLOB_NAME, "to Shelby...")
		const upload = await client.upload({
			blobData: readFileSync(UPLOAD_FILE),
			signer,
			blobName: BLOB_NAME,
			expirationMicros: Date.now() * 1000 + TIME_TO_LIVE,
		})
		console.log("*** Uploaded", BLOB_NAME, "successfully.")
		// No longer returning blob commitments from upload call
		// We need to make a call for blob metadata after upload
		// console.log("*** Merkle root:", upload.blobCommitments.blob_merkle_root)
		/**
		 * Retrieve a list of blobs stored on Shelby for this account
		 */
		console.log("*** Listing blobs stored on Shelby for this account...")
		const blobs = await client.coordination.getAccountBlobs({
			account: AccountAddress.fromString(SHELBY_ACCOUNT_ADDRESS),
		})
		for (const blob of blobs) {
			const expiryDate = new Date(Number(blob.expirationMicros) / 1000)
			const now = new Date()
			const isExpired = expiryDate < now
			const expiry = expiryDate.toLocaleString()

			const expiryText = isExpired
				? `expired: ${expiry}`
				: `expiring: ${expiry}`

			console.log(
				`· ${blob.name} — ${filesize(Number(blob.size))}, ${expiryText}`,
			)
		}
		/**
		 * Download the blob from Shelby
		 */
		console.log("*** Downloading the blob from Shelby...")
		const download = await client.download({ account, blobName: BLOB_NAME })
		console.log("*** Downloaded", BLOB_NAME, "successfully.")
		const outPath = join(process.cwd(), "downloads", BLOB_NAME)
		/**
		 * Save the blob to the local filesystem
		 */
		mkdirSync(dirname(outPath), { recursive: true })
		const stream: any = download.readable
		const nodeStream = typeof stream.getReader === 'function' ? Readable.fromWeb(stream) : stream
		await pipeline(nodeStream, createWriteStream(outPath))
		console.log("*** Saved the blob to", outPath)
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e)
		if (msg.includes("EBLOB_WRITE_CHUNKSET_ALREADY_EXISTS")) {
			console.error("*** This blob has already been uploaded.")
			return
		}
		if (msg.includes("INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE")) {
			console.error("*** Not enough APT to pay for transaction fee.")
			return
		}
		if (msg.includes("EBLOB_WRITE_INSUFFICIENT_FUNDS")) {
			console.error(
				"*** Not enough Shelby tokens to pay for blob storage.",
			)
			return
		}
		if (msg.includes("429")) {
			console.error("*** Rate limit exceeded (429).")
			return
		}
		/**
		 * If this occurs repeatedly, please contact Shelby support!
		 */
		if (/500|internal server error/i.test(msg)) {
			console.error("*** Server error occurred.")
			process.exit(1)
		}
		console.error("Unexpected error:\n", msg)
		process.exit(1)
	}
}

main()
