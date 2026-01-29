import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface UploadEntry {
	blobName: string
	accountAddress: string
	fileSizeMB: string
	uploadedAt: string
}

const UPLOADS_FILE = ".uploads"

function getUploadsFilePath(): string {
	return join(process.cwd(), UPLOADS_FILE)
}

export class UploadsFileCorruptedError extends Error {
	constructor(public readonly cause: unknown) {
		super("Uploads history file is corrupted")
		this.name = "UploadsFileCorruptedError"
	}
}

export function getUploads(): UploadEntry[] {
	const filePath = getUploadsFilePath()
	if (!existsSync(filePath)) {
		return []
	}
	const content = readFileSync(filePath, "utf8")
	try {
		const parsed = JSON.parse(content)
		if (!Array.isArray(parsed)) {
			throw new Error("Expected array")
		}
		return parsed as UploadEntry[]
	} catch (e) {
		throw new UploadsFileCorruptedError(e)
	}
}

export function addUpload(entry: UploadEntry): Error | null {
	const filePath = getUploadsFilePath()
	try {
		let uploads: UploadEntry[]
		try {
			uploads = getUploads()
		} catch (e) {
			if (e instanceof UploadsFileCorruptedError) {
				// Backup corrupted file before starting fresh
				const backupPath = `${filePath}.corrupted.${Date.now()}`
				renameSync(filePath, backupPath)
				console.warn(`Warning: Uploads history was corrupted. Backed up to ${backupPath}`)
				uploads = []
			} else {
				throw e
			}
		}
		uploads.push(entry)
		writeFileSync(filePath, JSON.stringify(uploads, null, 2))
		return null
	} catch (e) {
		return e as Error
	}
}

export function getLastUpload(): string | null {
	try {
		const uploads = getUploads()
		if (uploads.length === 0) {
			return null
		}
		return uploads[uploads.length - 1].blobName
	} catch (e) {
		if (e instanceof UploadsFileCorruptedError) {
			// Return null if history is corrupted - download can proceed without default
			return null
		}
		throw e
	}
}

export function formatUploadPath(entry: UploadEntry): string {
	return `@${entry.accountAddress}/${entry.blobName}`
}
