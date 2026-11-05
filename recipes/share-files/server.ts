// A small web server that hands out links to files on Shelby, so a browser can open
// or download them without your credentials.
//
//   GET /link?key=<key>[&download=1]  -> { url, expiresIn }  a link to one file
//   GET /share?folder=<prefix>        -> { url, expiresIn }  a link to a whole folder
//
// share.ts starts it and plays both the app's user and the person they share with.
// Copy the parts you need into your own app. The secret stays on the server; only
// links go to the browser.
import { createServer, type Server } from "node:http";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl, S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { formatUrl } from "@aws-sdk/util-format-url";

// How long each link works, in seconds. Shelby allows 1 second to 7 days (604800).
// The link is a bearer credential until then, so keep it short.
const EXPIRES_IN = 300;

export interface ShareServerOptions {
  s3: S3Client;
  bucket: string;
  /** The server links only to keys under this prefix. */
  prefix: string;
}

export function createShareServer({ s3, bucket, prefix }: ShareServerOptions): Server {
  return createServer(async (req, res) => {
    const reply = (status: number, body: object) => {
      // A link is a credential, so don't let a browser or proxy cache this response.
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") return reply(405, { error: "use GET" });

    // A real app authenticates its user here, from a session cookie or a token.
    // Then it checks that the key or folder they ask for is theirs, for example
    // users/<their id>/. This one lets anyone share anything under its prefix.
    try {
      if (url.pathname === "/link") {
        const key = url.searchParams.get("key") ?? "";
        if (!key.startsWith(prefix) || key === prefix) return reply(403, { error: "not your file" });
        const filename = key.slice(key.lastIndexOf("/") + 1);
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          // Shelby honours the response-* overrides in a link, except
          // response-cache-control and response-expires. This one makes the browser
          // save the file instead of showing it.
          ResponseContentDisposition:
            url.searchParams.get("download") === "1" ? attachment(filename) : undefined,
        });
        // Presigned URLs on Shelby are read-only: GetObject or HeadObject, one key.
        const link = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN });
        return reply(200, { url: link, expiresIn: EXPIRES_IN });
      }
      if (url.pathname === "/share") {
        const folder = url.searchParams.get("folder") ?? "";
        if (!folder.startsWith(prefix) || folder === prefix) return reply(403, { error: "not your folder" });
        const link = await getSignedFolderUrl(s3, { Bucket: bucket, Prefix: folder }, { expiresIn: EXPIRES_IN });
        return reply(200, { url: link, expiresIn: EXPIRES_IN });
      }
      return reply(404, { error: "not found" });
    } catch {
      return reply(500, { error: "couldn't sign the link" });
    }
  });
}

/** A Content-Disposition that downloads the file under its name. */
function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Sign a folder-share link. Opening it sets a cookie in the browser that can list
 * and read everything under the prefix, until the link expires.
 *
 * The link is a presigned GET /_auth/folder?bucket=…&prefix=…. That's a Shelby
 * extension, not an S3 operation, so getSignedUrl can't sign it. This signs it the
 * way getSignedUrl does, with your S3 client's endpoint, credentials and region.
 */
export async function getSignedFolderUrl(
  s3: S3Client,
  { Bucket, Prefix }: { Bucket: string; Prefix: string },
  { expiresIn = 600 }: { expiresIn?: number } = {},
): Promise<string> {
  // Shelby shares folders only, never a whole bucket. It adds a trailing slash.
  if (Prefix === "") throw new Error("Prefix must not be empty");
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604_800) {
    throw new Error("expiresIn must be a whole number of seconds from 1 to 604800");
  }
  const endpoint = await s3.config.endpoint?.();
  // The cookie is Secure, and a link sent over plain HTTP could be read on the way.
  if (endpoint?.protocol !== "https:") throw new Error("Folder shares need an HTTPS endpoint");
  const presigner = new S3RequestPresigner({ ...s3.config });
  const signed = await presigner.presign(
    {
      method: "GET",
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: `${endpoint.path.replace(/\/+$/, "")}/_auth/folder`,
      query: { bucket: Bucket, prefix: Prefix },
      headers: {},
    },
    { expiresIn },
  );
  return formatUrl(signed);
}
