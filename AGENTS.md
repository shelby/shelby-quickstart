# AGENTS.md

Runnable examples for Shelby's S3-compatible API: one per client in `clients/`, and
recipes for whole workflows in `recipes/`. Each one checks its own results and cleans up
after itself.

## Integrating Shelby into another project

1. Get credentials into `.env` (see below), then run `make doctor`.
2. Find the folder for the user's stack in `clients/` and read its README. "Use it in
   your project" has the exact client settings to copy.
3. Apply the rules in "Where Shelby differs from Amazon S3" below. They cover the places
   where code written for Amazon S3 needs a change. When moving existing S3 code, also
   check it against the migration table:
   <https://docs.shelby.xyz/tools/s3-gateway/migrating.md>.
4. For a whole workflow, start from a recipe. `recipes/migrate-from-s3` moves data from
   S3, R2 or MinIO. `recipes/ml-training` covers training data and checkpoints.
   `recipes/share-files` gives browsers download links and folder shares from a server.
5. Verify with the matching `make <client>`. Then run the user's code against a test
   prefix before it touches real data.

## Credentials

Three variables, in `.env` at the repository root (copy `.env.example`), and one optional:

| Variable | Value |
| --- | --- |
| `SHELBY_ACCESS_KEY_ID` | The access key ID. Starts with `SHLB`. |
| `SHELBY_SECRET_ACCESS_KEY` | The secret of the same access key |
| `SHELBY_BUCKET` | The name of the bucket the access key belongs to, for example `my-first-shelby-bucket` |
| `SHELBY_S3_ENDPOINT` | Optional. Overrides the endpoint. Defaults to `https://s3.beta.shelby.xyz`. |

Shelby organizes these as organization → projects → buckets → access keys. A bucket can
have several access keys, for example one per app or environment. Owners and admins create
projects, members create buckets and access keys, and viewers can't see secrets.

Only a person can get these, at <https://console.shelby.xyz>. Ask the user for them. Never
print them, log them or commit them.

## Commands

| Command | Does |
| --- | --- |
| `make doctor` | Checks credentials, bucket, clock and installed tools. Read-only. Run it first, and whenever a request fails with `401`. |
| `make aws-cli` | The AWS CLI v2 example |
| `make python` | The Python (boto3) example |
| `make javascript` | The JavaScript (AWS SDK v3) example. Installs its dependencies on the first run. |
| `make rclone` | The rclone example |
| `make duckdb` | The DuckDB example |
| `make migrate-from-s3` | Recipe: copy a public S3 dataset with rclone, verify it, query it with DuckDB |
| `make ml-training` | Recipe: PyTorch training from shards, with checkpoints and a resume |
| `make share-files` | Recipe: a Node.js server that hands out presigned links and folder shares. Installs its dependencies on the first run. |
| `make all` | `doctor`, then every example and recipe |
| `make lint` | shellcheck, ruff and tsc |

Add `ARGS=--large` to any example to include a multipart upload.

Every run prints one line per step (`ok <step>: …` or `FAIL <step>: <cause> -> <fix>`) and
ends with `RESULT ok` or `RESULT fail`. Trust the exit code.

## Where Shelby differs from Amazon S3

Shelby's API is S3-compatible, so standard S3 clients and code work against it. A few
behaviours don't match Amazon S3 yet. These rules cover them:

- Use the access key ID (`SHLB…`) and the secret as two different values.
- Set the region to `default` and use path-style addressing. Don't discover the region
  with `GetBucketLocation`.
- Each access key belongs to one bucket and reaches only that bucket: `ListBuckets`
  returns just that bucket, and any other bucket name gets `404 NoSuchBucket`, as if it
  didn't exist. People create buckets in the console or through MCP. `CreateBucket` on
  your own bucket returns `200` and does nothing. Never create, delete or rename buckets
  through the S3 API. For several buckets, use each bucket's own access key.
- Set `request_checksum_calculation` to `when_required` for the AWS CLI and boto3.
  Without it, uploads fail with `501 NotImplemented`.
- Listings lag writes by a few seconds; reads don't. Confirm a write with GET or HEAD,
  track the keys you wrote, and never treat a missing listing entry as a failed upload.
- Retry `503` on reads with backoff. A read just after a write or delete can briefly get
  one. AWS SDKs retry it by default.
- Never use `CopyObject`, `aws s3 mv` or `s3.copy`. There's no server-side copy, so
  download and upload again.
- Presigned URLs are read-only. Sign GET or HEAD for one object, on a server, with
  region `default`, for at most 7 days. Treat the URL as a password: never log it.
  Never presign uploads, deletes or listings, and never upload from a browser. CORS
  isn't configurable, so use presigned URLs as links and media sources, not `fetch()`.
- In the AWS SDK for JavaScript, delete one key at a time. `DeleteObjectsCommand` fails
  and deletes nothing. boto3's `delete_objects` and the AWS CLI's `delete-objects` work.
- In the AWS SDK for JavaScript, set `responseChecksumValidation: "WHEN_REQUIRED"` on the
  client. Without it, presigned GET URLs fail with `501 NotImplemented`.
- Treat a JavaScript SDK "XML parse error" as a `401`. Authentication errors are plain
  text, not S3 XML.
- Keep list page sizes at 1,000 or less. Larger values are rejected, not capped.
- Use parts of at least 10 MiB: each part counts as at least 10 MiB of storage. An upload
  has at most 3,000 parts, so the part size sets the largest file: 10 MiB parts reach
  about 29 GiB, 64 MiB about 187 GiB.
- In rclone, always pass `--checksum` to `copy` and `sync`.
- Keep `x-amz-meta-*` under 2 KB.

Full list, with every S3 feature: <https://docs.shelby.xyz/tools/s3-gateway/compatibility.md>

## Changing or adding an example

Every runnable file follows these rules, so a person or CI can trust its exit code.

1. **Configuration comes only from the environment.** Scripts read the variables above
   and never parse `.env` themselves.
2. **No prompts.** It must run unattended with `CI=true`.
3. **One line per step**, in the format above, then `RESULT ok` or `RESULT fail`.
4. **Write only under `quickstart/<example>/<run-id>/`.** Never read, write or delete
   anything else in the bucket.
5. **No side effects on the machine.** Use throwaway config files (`AWS_CONFIG_FILE`,
   `RCLONE_CONFIG`) and temp directories. Never touch `~/.aws` or `~/.config`.
6. **Always clean up**, on failure too. Delete the keys the run tracked; don't list the
   prefix to find them.
7. **Show the Shelby differences in code**, with a comment where each one applies.
8. **Small by default.** A default run moves under 1 MB. Larger transfers go behind
   `--large`. Generate sample data at runtime.
9. **Map known errors to a fix.** Missing variables, `401`, `403`, `404` on the bucket,
   and `501` each get a specific message.
10. **Self-contained folders.** A folder may import its own files, never another
    folder's. Duplicate small helpers instead.

Shell scripts must run on macOS's bash 3.2: no associative arrays, `mapfile` or
`${var,,}`, no GNU-only tools such as `timeout`, and no expanding an empty array under
`set -u`.

## Map

```
doctor/doctor.sh          read-only checks (bash and curl)
clients/aws-cli/          AWS CLI v2
clients/python/           boto3; shelby_s3.py is the client to copy
clients/javascript/       AWS SDK v3 in Node 22.18+; shelby-s3.ts is the client to copy
clients/rclone/           rclone
clients/duckdb/           DuckDB httpfs; cleanup uses curl, since DuckDB can't delete
recipes/migrate-from-s3/  rclone from Amazon S3 to Shelby, verified with rclone check and DuckDB
recipes/ml-training/      PyTorch: manifest-driven shards, create-only checkpoints, resume
recipes/share-files/      Node.js: a server that signs download links and folder shares
Makefile                  the commands above
.env.example              the variables
.github/workflows/        lint.yml on every PR; verify.yml runs everything live, nightly
.github/scripts/sweep.py  CI only: clears quickstart/ objects left by killed runs
.github/scripts/notify-slack.sh  CI only: posts to Slack when verify fails on main, and when it recovers
```

Docs as Markdown, for agents: <https://docs.shelby.xyz/llms-full.txt>, or append `.md` to
any docs URL.
