// Store, read, list and delete objects on Shelby with the AWS SDK for JavaScript v3.
//
//   make javascript [ARGS=--large]
//   or, in this folder: npm ci && node --env-file=../../.env quickstart.ts [--large]
//
// Everything it writes goes under quickstart/javascript/<run-id>/ in your bucket and
// is deleted at the end, even if a step fails. Exits 0 only when every step passes.
import { createHash, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const REQUIRED = ["SHELBY_ACCESS_KEY_ID", "SHELBY_SECRET_ACCESS_KEY", "SHELBY_BUCKET"];
const CONSOLE = "https://console.shelby.xyz";
const DOCS = "https://docs.shelby.xyz/tools/s3-gateway";
const MiB = 1024 * 1024;

class StepFailed extends Error {}

function ok(step: string, detail: string): void {
  console.log(`ok   ${step}: ${detail}`);
}

function fail(step: string, cause: string, fix: string): never {
  throw new StepFailed(`FAIL ${step}: ${cause} -> ${fix}`);
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

/** Turn an SDK error into a FAIL line with a fix. */
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
    fix = "SHELBY_BUCKET must be your own bucket";
  } else if (status === 501) {
    cause = `501 ${message}`;
    fix = `Shelby doesn't support this call; see ${DOCS}/compatibility`;
  }
  return `FAIL ${step}: ${cause} -> ${fix}`;
}

/** Report any SDK error raised inside fn as a failure of this step. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StepFailed) throw err;
    throw new StepFailed(explain(name, err));
  }
}

async function run(
  s3: S3Client,
  Bucket: string,
  prefix: string,
  written: string[],
  large: boolean,
): Promise<void> {
  const Key = `${prefix}hello.txt`;
  const body = Buffer.from("Hello, Shelby\n");

  await step("put", () =>
    s3.send(
      new PutObjectCommand({
        Bucket,
        Key,
        Body: body,
        ContentType: "text/plain",
        Metadata: { example: "javascript" },
      }),
    ),
  );
  written.push(Key);
  ok("put", Key);

  // Reads see a new object as soon as the PUT returns. No waiter needed.
  const data = await step("get", async () => {
    const object = await s3.send(new GetObjectCommand({ Bucket, Key }));
    return object.Body!.transformToByteArray();
  });
  if (sha256(data) !== sha256(body)) {
    fail("get", "the bytes read back don't match", "report this in Discord");
  }
  ok("get", "read back immediately, SHA-256 matches");

  const head = await step("head", () => s3.send(new HeadObjectCommand({ Bucket, Key })));
  if (head.ContentType !== "text/plain" || head.Metadata?.example !== "javascript") {
    fail("head", `metadata came back as ${head.ContentType} ${JSON.stringify(head.Metadata)}`, "report this in Discord");
  }
  ok("head", "Content-Type and x-amz-meta-* are stored");

  // Create-only writes are enforced. (If-Match on overwrite isn't yet.)
  const overwrote = await step("create-only", async () => {
    try {
      await s3.send(new PutObjectCommand({ Bucket, Key, Body: "overwrite?", IfNoneMatch: "*" }));
      return true;
    } catch (err) {
      if (statusOf(err) === 412) return false;
      throw err;
    }
  });
  if (overwrote) {
    fail("create-only", "If-None-Match: * overwrote an existing key", "don't rely on create-only writes until this passes");
  }
  ok("create-only", "If-None-Match: * refused to overwrite (412)");

  // Listings lag writes by a few seconds, so retry. Keep MaxKeys at 1,000 or less:
  // Shelby rejects larger page sizes instead of capping them.
  const started = Date.now();
  for (;;) {
    const page = await step("list", () =>
      s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: 1000 })),
    );
    if (page.Contents?.some((object) => object.Key === Key)) break;
    if (Date.now() - started > 30_000) {
      fail("list", `${Key} isn't listed after 30s`, "retry; listings usually catch up in seconds");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  ok("list", `listed after ${Math.round((Date.now() - started) / 1000)}s`);

  if (large) {
    // Shelby allows 3,000 parts per upload, so the part size sets your largest file:
    // 64 MiB parts give about 187 GiB. 5 MiB parts here upload 12 MiB in 3 parts.
    const largeKey = `${prefix}large.bin`;
    const payload = randomBytes(12 * MiB);
    await step("large", () =>
      new Upload({ client: s3, params: { Bucket, Key: largeKey, Body: payload }, partSize: 5 * MiB }).done(),
    );
    written.push(largeKey);
    const { ETag } = await step("large", () => s3.send(new HeadObjectCommand({ Bucket, Key: largeKey })));
    const copy = await step("large", async () => {
      const object = await s3.send(new GetObjectCommand({ Bucket, Key: largeKey }));
      return object.Body!.transformToByteArray();
    });
    if (sha256(copy) !== sha256(payload)) {
      fail("large", "the downloaded file doesn't match", "report this in Discord");
    }
    ok("large", `12 MiB in 5 MiB parts (ETag ${ETag?.replaceAll('"', "")}), downloaded and matched`);
  }

  // Delete one key at a time. DeleteObjectsCommand sends `/{bucket}/?delete`, which
  // Shelby doesn't recognise yet, so it silently deletes nothing.
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
const prefix = `quickstart/javascript/${runId}/`;
const written: string[] = [];
try {
  await run(s3, Bucket, prefix, written, process.argv.includes("--large"));
  console.log("RESULT ok");
} catch (err) {
  console.log(err instanceof StepFailed ? err.message : `FAIL unexpected: ${String(err)} -> report this in Discord`);
  await cleanup(s3, Bucket, written);
  console.log("RESULT fail");
  process.exitCode = 1;
}
