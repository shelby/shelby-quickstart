# JavaScript (AWS SDK v3)

Store, read, list and delete objects on Shelby with `@aws-sdk/client-s3` in Node.js.

## Run it

You need Node.js 22.18 or later, which runs TypeScript files directly. From the
repository root, with `.env` filled in:

```bash
make javascript                 # installs dependencies on the first run
make javascript ARGS=--large    # also uploads a 12 MiB body in parts
```

Or, in this folder: `npm ci`, then `node --env-file=../../.env quickstart.ts`.

The script writes only under `quickstart/javascript/<run-id>/` in your bucket, deletes
what it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| put | `PutObjectCommand` with `ContentType` and `Metadata` |
| get | Reading the object straight back. No waiter needed. |
| head | `Content-Type` and `x-amz-meta-*` are stored |
| presign | `getSignedUrl` for a link that expires in 300 s, read by plain `fetch` with no credentials |
| create-only | `IfNoneMatch: "*"` refuses to overwrite an existing key (`412`) |
| list | Retrying while the listing catches up, with `MaxKeys` at 1,000 |
| large | `Upload` from `@aws-sdk/lib-storage` with an explicit `partSize` (`--large` only) |
| delete | One `DeleteObjectCommand` per key, then `HeadObjectCommand` to confirm |

## Use it in your project

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
```

Copy [`shelby-s3.ts`](shelby-s3.ts) and import `s3` and `Bucket` from it. It's a standard
`S3Client` with these settings:

```ts
export const s3 = new S3Client({
  endpoint: "https://s3.beta.shelby.xyz",
  region: "default",
  credentials: {
    accessKeyId: process.env.SHELBY_ACCESS_KEY_ID!,          // starts with SHLB
    secretAccessKey: process.env.SHELBY_SECRET_ACCESS_KEY!,  // the console's "API key"
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
```

`requestChecksumCalculation` is optional. It stops the SDK from computing CRC checksums
that Shelby accepts but doesn't verify. `responseChecksumValidation` is needed for
presigned URLs: without it, the SDK adds `x-amz-checksum-mode` to presigned `GetObject`
URLs, which Shelby refuses with `501`. Shelby returns no response checksums, so it skips
no checks. When Node runs TypeScript directly, import the file with its extension:
`import { s3, Bucket } from "./shelby-s3.ts"`.

To let someone download an object without your credentials, presign a link on your
server. It works for `GetObjectCommand` and `HeadObjectCommand`, for up to 7 days
(604800 seconds):

```ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: "reports/q3.pdf" }), {
  expiresIn: 3600,
});
```

Anyone with the link can read that object until it expires, so treat it like a password
and keep it out of logs.

## What's different with the AWS SDK for JavaScript

- **Delete one key at a time.** `DeleteObjectsCommand` sends `/{bucket}/?delete`, which
  Shelby doesn't recognise yet. It returns an error status and deletes nothing.
- **Listings lag writes by a few seconds; reads don't.** Confirm a write with
  `GetObjectCommand` or `HeadObjectCommand`, and track the keys you wrote.
- **Run it on a server.** The secret must never reach a browser, and Shelby's CORS isn't
  configurable. For browser downloads, sign a link on your server and use it as a link, a
  download, or an `<img>` or `<video>` source. Don't build on `fetch()` of the endpoint
  from another origin. Browsers can't upload: there are no presigned uploads.
- **Presigned URLs are for downloads only.** Sign `GetObjectCommand` or
  `HeadObjectCommand`, with `responseChecksumValidation: "WHEN_REQUIRED"` on the client.
- **`CopyObjectCommand` fails with `501`.** Download and upload again.
- **A `401` can surface as an XML parse error.** Shelby's authentication errors are plain
  text. Run `make doctor` to see the reason.
- **Set the region yourself.** `GetBucketLocation` returns the object listing on Shelby,
  so the SDK can't discover it.
- **The SDK ignores `HTTPS_PROXY`.** Behind a proxy, pass an agent to the client's
  `NodeHttpHandler`, for example from the `https-proxy-agent` package.

Docs: [JavaScript quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/javascript) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
