# rclone

Copy, check, sync and delete files on Shelby with rclone.

## Run it

You need rclone 1.60 or later. From the repository root, with `.env` filled in:

```bash
make rclone                 # or: set -a; . ./.env; set +a; bash clients/rclone/quickstart.sh
make rclone ARGS=--large    # also uploads a 12 MiB file in parts
```

The script uses a throwaway rclone config, so it never reads or changes your own
`rclone.conf`. It writes only under `quickstart/rclone/<run-id>/` in your bucket, deletes
what it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| remote | The remote settings Shelby needs |
| copy | `rclone copy --checksum` of a directory |
| list | `rclone lsf`, retrying while the listing catches up |
| check | `rclone check --one-way`: sizes and MD5 hashes match |
| sync | A second `rclone sync --checksum` that transfers nothing |
| download | Copying back down, with a SHA-256 check |
| large | A multipart upload within the 3,000-part limit (`--large` only) |
| delete | `rclone deletefile` on the keys the run tracked, then a check that they're gone |

## Use it in your project

Create a permanent `shelby` remote:

```bash
rclone config create shelby s3 \
  provider=Other \
  endpoint=https://s3.beta.shelby.xyz \
  access_key_id="$SHELBY_ACCESS_KEY_ID" \
  secret_access_key="$SHELBY_SECRET_ACCESS_KEY" \
  region=default \
  force_path_style=true \
  max_upload_parts=3000 >/dev/null
```

`rclone config create` prints the new config, secret included. The `>/dev/null` keeps the
secret out of your terminal's scrollback, and out of an agent's transcript.

Then use the full path, bucket included: `rclone copy ./data "shelby:$SHELBY_BUCKET/data"
--checksum`.

## What's different with rclone

- **Always pass `--checksum` to `copy` and `sync`.** Without it, rclone compares
  modification times, and when they differ it updates them with a server-side copy, which
  Shelby doesn't support. That fails with `501 NotImplemented`.
- **`max_upload_parts=3000` matches Shelby's part limit.** rclone raises the part size for
  large files to fit.
- **Listings lag writes by a few seconds; reads don't.** `rclone check`, `delete` and
  `purge` work from listings, so they can miss an object written seconds ago.
- **Every upload is a full write.** Re-uploading an unchanged file repeats the whole
  upload, which is another reason for `--checksum`.
- **Server-side `copy` or `move` between two Shelby paths fails.** Download and upload
  again.
- **`-vv` doesn't show HTTP traffic.** To debug a request, use `--dump headers`.

Docs: [rclone quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/rclone) ·
[Migrating from S3](https://docs.shelby.xyz/tools/s3-gateway/migrating) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
