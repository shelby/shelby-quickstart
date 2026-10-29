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
| create-only | `IfNoneMatch: "*"` refuses to overwrite an existing key (`412`) |
| list | Retrying while the listing catches up, with `MaxKeys` at 1,000 |
| large | `Upload` from `@aws-sdk/lib-storage` with an explicit `partSize` (`--large` only) |
| delete | One `DeleteObjectCommand` per key, then `HeadObjectCommand` to confirm |

## Use it in your project

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
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
});
```

`requestChecksumCalculation` is optional. It stops the SDK from computing CRC checksums
that Shelby accepts but doesn't verify. When Node runs TypeScript directly, import the
file with its extension: `import { s3, Bucket } from "./shelby-s3.ts"`.

## What's different with the AWS SDK for JavaScript

- **Delete one key at a time.** `DeleteObjectsCommand` sends `/{bucket}/?delete`, which
  Shelby doesn't recognise yet. It returns an error status and deletes nothing.
- **Listings lag writes by a few seconds; reads don't.** Confirm a write with
  `GetObjectCommand` or `HeadObjectCommand`, and track the keys you wrote.
- **Run it on a server.** Shelby doesn't support CORS or presigned URLs yet, so browsers
  can't call the endpoint directly.
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
