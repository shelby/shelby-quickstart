import { existsSync, readFileSync, writeFileSync } from "node:fs"
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

export function getUploads(): UploadEntry[] {
	const filePath = getUploadsFilePath()
	try {
		if (!existsSync(filePath)) {
			return []
		}
		const content = readFileSync(filePath, "utf8")
		return JSON.parse(content) as UploadEntry[]
	} catch {
		return []
	}
}

export function addUpload(entry: UploadEntry): Error | null {
	const filePath = getUploadsFilePath()
	try {
		const uploads = getUploads()
		uploads.push(entry)
		writeFileSync(filePath, JSON.stringify(uploads, null, 2))
		return null
	} catch (e) {
		return e as Error
	}
}

export function getLastUpload(): string | null {
	const uploads = getUploads()
	if (uploads.length === 0) {
		return null
	}
	return uploads[uploads.length - 1].blobName
}

export function formatUploadPath(entry: UploadEntry): string {
	return `@${entry.accountAddress}/${entry.blobName}`
}
