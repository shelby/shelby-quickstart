# AGENTS.md

Runnable examples for Shelby's S3-compatible API. Each folder under `clients/` is one
complete example that checks its own results and cleans up after itself.

## Integrating Shelby into another project

1. Find the folder for the user's stack in `clients/` and read its README. "Use it in
   your project" has the exact client settings.
2. Apply the rules in "Shelby is not quite S3" below. They are where code written for
   Amazon S3 breaks.
3. Verify with `make doctor`, then the matching `make <client>`.

## Credentials

Three variables, in `.env` at the repository root (copy `.env.example`):

| Variable | Value |
| --- | --- |
| `SHELBY_ACCESS_KEY_ID` | The access key ID. Starts with `SHLB`. |
| `SHELBY_SECRET_ACCESS_KEY` | The secret. The console calls it the "API key". |
| `SHELBY_BUCKET` | The bucket name, for example `shelby-managed-account-1` |

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
| `make all` | `doctor`, then every example and recipe |
| `make lint` | shellcheck, ruff and tsc |

Add `ARGS=--large` to any example to include a multipart upload.

Every run prints one line per step (`ok <step>: …` or `FAIL <step>: <cause> -> <fix>`) and
ends with `RESULT ok` or `RESULT fail`. Trust the exit code.

## Shelby is not quite S3

- Use the access key ID (`SHLB…`) and the secret as two different values. Never put the
  API key in both fields; older docs did.
- Set the region to `default` and use path-style addressing. Don't discover the region
  with `GetBucketLocation`.
- There is exactly one bucket per account, with a fixed name. Never create, delete or
  rename buckets. Use key prefixes instead.
- Set `request_checksum_calculation` to `when_required` for the AWS CLI and boto3.
  Without it, uploads fail with `501 NotImplemented`.
- Listings lag writes by a few seconds; reads don't. Confirm a write with GET or HEAD,
  track the keys you wrote, and never treat a missing listing entry as a failed upload.
- Never use `CopyObject`, `aws s3 mv` or `s3.copy`. There's no server-side copy, so
  download and upload again.
- Never generate presigned URLs or upload from a browser. Neither is supported yet, and
  there's no CORS. Upload from a server.
- In the AWS SDK for JavaScript, delete one key at a time. `DeleteObjectsCommand` fails
  and deletes nothing. boto3's `delete_objects` and the AWS CLI's `delete-objects` work.
- Treat a JavaScript SDK "XML parse error" as a `401`. Authentication errors are plain
  text, not S3 XML.
- Keep list page sizes at 1,000 or less. Larger values are rejected, not capped.
- Choose a part size for the 3,000-part limit. At 8 MiB parts, files over about 23 GiB
  fail partway.
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
Makefile                  the commands above
.env.example              the three variables
```

Docs as Markdown, for agents: <https://docs.shelby.xyz/llms-full.txt>, or append `.md` to
any docs URL.
