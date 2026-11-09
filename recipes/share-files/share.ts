// Share files on Shelby through links: a small server signs them, and someone with
// no credentials opens them.
//
//   make share-files
//   or, in this folder: npm ci && node --env-file=../../.env share.ts
//
// One run plays three parts: the server in server.ts, the app's user asking it for
// links, and the recipient opening them with plain fetch. Everything it writes goes
// under quickstart/share-files/<run-id>/ in your bucket and is deleted at the end,
// even if a step fails. Links and cookies are never printed: each one is a bearer
// credential. Exits 0 only when every step passes.
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createShareServer } from "./server.ts";

const REQUIRED = ["SHELBY_ACCESS_KEY_ID", "SHELBY_SECRET_ACCESS_KEY", "SHELBY_BUCKET"];
const CONSOLE = "https://console.shelby.xyz";
const DOCS = "https://docs.shelby.xyz/tools/s3-gateway";
const COOKIE = "__Host-Shelby-Folder-Access";

// A 1x1 PNG, the smallest valid image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

class StepFailed extends Error {}

function ok(step: string, detail: string): void {
  console.log(`ok   ${step}: ${detail}`);
}

function fail(step: string, cause: string, fix: string): never {
  throw new StepFailed(`FAIL ${step}: ${cause} -> ${fix}`);
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

/** Turn an SDK or network error into a FAIL line with a fix. */
function explain(step: string, err: unknown): string {
  const name = (err as { name?: string })?.name ?? "Error";
  const message = (err as { message?: string })?.message ?? String(err);
  const status = statusOf(err);
  let cause = `${name}: ${message}`;
  let fix = `see ${DOCS}/troubleshooting`;
  if (status === 401) {
    // Shelby's 401s are plain text. The SDK expects XML, so it reports a parse
    // error rather than the reason.
    cause = "401 Unauthorized (the SDK reports it as an XML parse error)";
    fix = "run `make doctor`, which shows the reason";
  } else if (name === "NoSuchBucket") {
    cause = "404 NoSuchBucket";
    fix = `copy your bucket name from ${CONSOLE}`;
  } else if (name === "AccessDenied" || status === 403) {
    cause = "403 AccessDenied";
    fix = "SHELBY_BUCKET must be the bucket this access key belongs to";
  } else if (status === 501) {
    cause = `501 ${message}`;
    fix = `Shelby doesn't support this call; see ${DOCS}/compatibility`;
  } else if (message === "fetch failed") {
    cause = `fetch failed: ${String((err as { cause?: unknown }).cause ?? "no details")}`;
    fix = "check your connection and SHELBY_S3_ENDPOINT";
  }
  return `FAIL ${step}: ${cause} -> ${fix}`;
}

/** Report any error raised inside fn as a failure of this step. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StepFailed) throw err;
    throw new StepFailed(explain(name, err));
  }
}

/** Open a URL as the recipient: plain fetch, no credentials, the whole body read. */
async function open(url: string | URL, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const body = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body, text: Buffer.from(body).toString() };
}
type Opened = Awaited<ReturnType<typeof open>>;

/**
 * Fail the step unless the response has the expected status, with a fix for the
 * status it has. Shelby gives the reason as plain text, not S3 XML.
 */
function expectStatus(step: string, response: Opened, expected: number): void {
  const { status } = response;
  if (status === expected) return;
  const text = response.text.trim();
  // Errors from further in, such as 404 NoSuchKey, are S3 XML. Keep only the code.
  const reason = text.startsWith("<")
    ? (/<Code>(\w+)<\/Code>/.exec(text)?.[1] ?? "")
    : text.split("\n")[0].split(". ")[0].slice(0, 200);
  let fix = `see ${DOCS}/troubleshooting`;
  if (status === 401 && reason.includes("expired")) {
    fix = "sign a new link, and check your clock with `make doctor`";
  } else if (status === 401 && reason.includes("AccessKeyId")) {
    fix = `sign with the SHLB access key ID from ${CONSOLE}`;
  } else if (status === 401) {
    fix = "sign with region default and the secret that matches the key, and don't change the URL after signing";
  } else if (status === 400 && reason.includes("region")) {
    fix = "sign with region default";
  } else if (status === 400 && reason.includes("not supported")) {
    fix = "drop ResponseCacheControl and ResponseExpires; the other Response* overrides work";
  } else if (status === 400 && reason.includes("X-Amz-Expires")) {
    fix = "set expiresIn between 1 and 604800 seconds (7 days)";
  } else if (status === 403 && reason.includes("Folder cookie")) {
    fix = "a folder cookie lists and reads only under its own prefix, and never writes";
  } else if (status === 405) {
    fix = "presign GetObjectCommand or HeadObjectCommand only, and upload from a server with your credentials";
  } else if (status === 501 && text.includes("checksum")) {
    fix = 'set responseChecksumValidation: "WHEN_REQUIRED" on the S3Client (see shelby-s3.ts)';
  } else if (status === 503) {
    fix = "too many downloads at once; retry after the Retry-After delay";
  }
  fail(step, `expected ${expected}, got ${status}${reason ? ` ${reason}` : ""}`, fix);
}

async function run(s3: S3Client, Bucket: string, prefix: string, written: string[], server: Server): Promise<void> {
  const page = {
    Key: `${prefix}page.html`,
    Body: Buffer.from("<!doctype html><title>Shared</title><p>Hello from Shelby</p>\n"),
    ContentType: "text/html; charset=utf-8",
  };
  const image = { Key: `${prefix}image.png`, Body: PNG, ContentType: "image/png" };
  const report = {
    Key: `${prefix}docs/report.txt`,
    Body: Buffer.from("Quarterly report: all good.\n"),
    ContentType: "text/plain",
  };

  for (const file of [page, image, report]) {
    await step("upload", () => s3.send(new PutObjectCommand({ Bucket, ...file })));
    written.push(file.Key);
  }
  ok("upload", "an HTML page, an image, and docs/report.txt");

  await step("serve", () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    }),
  );
  const { port } = server.address() as AddressInfo;
  // The server signs links only for keys it allows: here, this run's prefix.
  const refused = await step("serve", () => fetch(`http://127.0.0.1:${port}/link?key=quickstart%2Fother`));
  await refused.body?.cancel();
  if (refused.status !== 403) {
    fail("serve", `a key outside the prefix got ${refused.status}, not 403`, "check the prefix test in server.ts");
  }
  ok("serve", `listening on 127.0.0.1:${port}, and refusing to sign keys outside this run's prefix (403)`);

  /** Ask the server for a link, as the app's signed-in user would. */
  const askServer = (name: string, path: string) =>
    step(name, async () => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!response.ok) fail(name, `the server answered ${response.status} ${await response.text()}`, "see server.ts");
      return (await response.json()) as { url: string; expiresIn: number };
    });

  // The recipient opens the link with nothing else: no credentials, no SDK.
  const pageLink = await askServer("link", `/link?key=${encodeURIComponent(page.Key)}`);
  const opened = await step("link", () => open(pageLink.url));
  expectStatus("link", opened, 200);
  if (sha256(opened.body) !== sha256(page.Body)) {
    fail("link", "the page fetched through the link doesn't match", "report this in Discord");
  }
  const type = opened.headers.get("content-type") ?? "";
  if (!type.startsWith("text/html")) fail("link", `Content-Type is "${type}", not text/html`, "set ContentType when uploading");
  // Every presigned response says Cache-Control: private, no-store, so browsers and
  // CDNs keep no copy, and Referrer-Policy: no-referrer, so the link doesn't leak
  // to other sites in a Referer header.
  const cache = opened.headers.get("cache-control") ?? "";
  const referrer = opened.headers.get("referrer-policy") ?? "";
  if (!cache.includes("no-store") || referrer !== "no-referrer") {
    fail("link", `Cache-Control is "${cache}" and Referrer-Policy is "${referrer}"`, "report this in Discord");
  }
  ok("link", `the page opened through a ${pageLink.expiresIn} s link with no credentials: 200, text/html, no-store, no-referrer`);

  const reportLink = await askServer("download", `/link?key=${encodeURIComponent(report.Key)}&download=1`);
  const saved = await step("download", () => open(reportLink.url));
  expectStatus("download", saved, 200);
  const disposition = saved.headers.get("content-disposition") ?? "";
  if (!disposition.startsWith("attachment") || !disposition.includes('filename="report.txt"')) {
    fail("download", `Content-Disposition is "${disposition}"`, "pass ResponseContentDisposition when signing (see server.ts)");
  }
  if (sha256(saved.body) !== sha256(report.Body)) fail("download", "the file doesn't match", "report this in Discord");
  ok("download", "the download link came back with Content-Disposition: attachment and the file name");

  // A link is signed for one method. A HEAD link gives the size and type with no
  // download; a server signs HeadObjectCommand for it, as here.
  const headUrl = await step("head", () =>
    getSignedUrl(s3, new HeadObjectCommand({ Bucket, Key: image.Key }), { expiresIn: 300 }),
  );
  const head = await step("head", () => open(headUrl, { method: "HEAD" }));
  expectStatus("head", head, 200);
  const length = head.headers.get("content-length");
  if (length !== String(PNG.length) || head.headers.get("content-type") !== "image/png") {
    fail("head", `got Content-Length ${length}, Content-Type ${head.headers.get("content-type")}`, "report this in Discord");
  }
  ok("head", `a HeadObject link gave the image's size (${length} bytes) and type`);

  // One link serves any number of range requests until it expires, which is how a
  // <video> element seeks. Each GET counts toward your concurrent downloads.
  const imageLink = await askServer("range", `/link?key=${encodeURIComponent(image.Key)}`);
  const part = await step("range", () => open(imageLink.url, { headers: { range: "bytes=0-15" } }));
  expectStatus("range", part, 206);
  const range = part.headers.get("content-range");
  if (sha256(part.body) !== sha256(PNG.subarray(0, 16)) || range !== `bytes 0-15/${PNG.length}`) {
    fail("range", `got ${part.body.length} bytes and Content-Range ${range}`, "report this in Discord");
  }
  ok("range", "Range: bytes=0-15 on the image link gave 206 and the first 16 bytes");

  // A link stops working when it expires. You can't revoke one link; disabling the
  // access key revokes all of its links.
  const shortUrl = await step("expired", () =>
    getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: page.Key }), { expiresIn: 1 }),
  );
  await sleep(3000);
  const late = await step("expired", () => open(shortUrl));
  if (late.status === 200) {
    fail("expired", "a link signed for 1 s still worked 3 s later", "check your clock with `make doctor`");
  }
  expectStatus("expired", late, 401);
  if (!late.text.includes("expired")) fail("expired", `got 401 "${late.text.trim()}"`, "report this in Discord");
  ok("expired", "a link signed for 1 s was refused 3 s later (401 Presigned URL has expired)");

  // Changing any part of a link, such as the key, the expiry or the signature,
  // breaks it.
  const tampered = pageLink.url.replace(/([?&]X-Amz-Signature=)([0-9a-f])/, (_match, name: string, digit: string) =>
    name + (digit === "0" ? "1" : "0"),
  );
  if (tampered === pageLink.url) fail("tampered", "the link has no X-Amz-Signature", "report this in Discord");
  const forged = await step("tampered", () => open(tampered));
  expectStatus("tampered", forged, 401);
  if (!forged.text.includes("Invalid signature")) fail("tampered", `got 401 "${forged.text.trim()}"`, "report this in Discord");
  ok("tampered", "the page link with one signature digit changed was refused (401 Invalid signature)");

  // A folder share is a Shelby extension. The recipient opens the link like any page,
  // gets a cookie for the folder, and is redirected to the folder's listing.
  const folder = `${prefix}docs/`;
  const shareLink = await askServer("folder", `/share?folder=${encodeURIComponent(folder)}`);
  const redeemed = await step("folder", () => open(shareLink.url, { redirect: "manual" }));
  expectStatus("folder", redeemed, 303);
  const cookies = redeemed.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${COOKIE}=`));
  const attributes = (cookies[0] ?? "").split(";").slice(1).map((attribute) => attribute.trim().toLowerCase());
  const absent = ["httponly", "secure", "samesite=lax", "path=/"].filter((attribute) => !attributes.includes(attribute));
  if (cookies.length !== 1 || absent.length > 0) {
    const cause = `expected one ${COOKIE} cookie, got ${cookies.length}, missing ${absent.join(", ") || "nothing"}`;
    fail("folder", cause, "report this in Discord");
  }
  // The cookie expires with the link, not a full lifetime after it's opened.
  const maxAge = Number(attributes.find((attribute) => attribute.startsWith("max-age="))?.slice(8));
  if (!(maxAge > 0 && maxAge <= shareLink.expiresIn)) {
    fail("folder", `the cookie's Max-Age is ${maxAge}, outside the link's ${shareLink.expiresIn} s`, "report this in Discord");
  }
  // The Location is relative, so resolve it against the link, as a browser does.
  const listing = new URL(redeemed.headers.get("location") ?? "", shareLink.url);
  if (listing.searchParams.get("list-type") !== "2" || listing.searchParams.get("prefix") !== folder) {
    fail("folder", "the redirect isn't to a listing of the shared folder", "report this in Discord");
  }
  ok("folder", `the link set one ${COOKIE} cookie (HttpOnly, Secure, SameSite=Lax, Max-Age ${maxAge}) and redirected (303)`);

  // A browser sends the cookie by itself. fetch needs it set by hand.
  const withCookie = { headers: { cookie: cookies[0].split(";")[0] } };
  // Listings lag writes by a few seconds, so retry. The listing is S3 XML, not a page.
  const started = Date.now();
  for (;;) {
    const list = await step("cookie", () => open(listing, withCookie));
    expectStatus("cookie", list, 200);
    if (list.text.includes(`<Key>${report.Key}</Key>`)) break;
    if (Date.now() - started > 30_000) {
      fail("cookie", `${report.Key} isn't listed after 30s`, "retry; listings usually catch up in seconds");
    }
    await sleep(1000);
  }
  const waited = Math.round((Date.now() - started) / 1000);
  // Under the cookie, an object's URL is its plain path, with no query string.
  const objectUrl = (key: string) => {
    const url = new URL(listing);
    url.pathname += `/${key.split("/").map(encodeURIComponent).join("/")}`;
    url.search = "";
    return url;
  };
  const inside = await step("cookie", () => open(objectUrl(report.Key), withCookie));
  expectStatus("cookie", inside, 200);
  if (sha256(inside.body) !== sha256(report.Body)) {
    fail("cookie", "the file read with the cookie doesn't match", "report this in Discord");
  }
  const outside = await step("cookie", () => open(objectUrl(page.Key), withCookie));
  expectStatus("cookie", outside, 403);
  if (!outside.text.includes("Folder cookie")) fail("cookie", `got 403 "${outside.text.trim()}"`, "report this in Discord");
  ok("cookie", `listed docs/ after ${waited}s and read report.txt (200); page.html, outside docs/, was refused (403)`);

  // Delete one key at a time: DeleteObjectsCommand isn't supported yet.
  for (const key of written) {
    await step("delete", () => s3.send(new DeleteObjectCommand({ Bucket, Key: key })));
  }
  for (const key of written) {
    const gone = await step("delete", async () => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return false;
      } catch (err) {
        if (statusOf(err) === 404) return true;
        throw err;
      }
    });
    if (!gone) fail("delete", `${key} still exists after delete`, "report this in Discord");
  }
  ok("delete", `deleted ${written.length} object(s) one at a time, HEAD confirms they're gone`);
  written.length = 0;
}

/** Best effort, after a failure: delete whatever this run left behind. */
async function cleanup(s3: S3Client, Bucket: string, written: string[]): Promise<void> {
  if (written.length === 0) return;
  const results = await Promise.allSettled(
    written.map((key) => s3.send(new DeleteObjectCommand({ Bucket, Key: key }))),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  console.log(
    failed === 0
      ? `cleanup: deleted ${written.length} object(s) left by the failed run`
      : `cleanup: couldn't delete ${failed} of ${written.length} object(s): ${written.join(" ")}`,
  );
}

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.log(`FAIL env: missing ${missing.join(", ")} -> copy .env.example to .env and fill it in from ${CONSOLE}`);
  console.log("RESULT fail");
  process.exit(1);
}

// Imported after the check, because the client reads the environment when it loads.
const { s3, Bucket } = await import("./shelby-s3.ts");

const runId = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
const prefix = `quickstart/share-files/${runId}/`;
const written: string[] = [];
// The server links only to this run's files.
const server = createShareServer({ s3, bucket: Bucket, prefix });
try {
  await run(s3, Bucket, prefix, written, server);
  console.log("RESULT ok");
} catch (err) {
  console.log(err instanceof StepFailed ? err.message : `FAIL unexpected: ${String(err)} -> report this in Discord`);
  await cleanup(s3, Bucket, written);
  console.log("RESULT fail");
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
  server.closeAllConnections();
}
