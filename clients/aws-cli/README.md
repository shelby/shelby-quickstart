# AWS CLI

Store, read, list, sync and delete objects on Shelby with the AWS CLI v2.

## Run it

From the repository root, with `.env` filled in:

```bash
make aws-cli                 # or: set -a; . ./.env; set +a; bash clients/aws-cli/quickstart.sh
make aws-cli ARGS=--large    # also uploads a 12 MiB file in parts
```

The script uses a throwaway AWS config, so it never reads or changes your `~/.aws`
files. It writes only under `quickstart/aws-cli/<run-id>/` in your bucket, deletes what
it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| profile | The profile settings Shelby needs |
| put, get | `aws s3 cp` both ways, read back straight away, with a SHA-256 check |
| presign | `aws s3 presign` for a link that expires in 300 s, fetched by `curl` with no credentials |
| list | `aws s3 ls`, retrying while the listing catches up |
| sync | `aws s3 sync`, then a second sync that uploads nothing |
| large | `s3.multipart_chunksize` for multipart uploads (`--large` only) |
| delete | `aws s3api delete-objects` on the keys the run tracked, then `head-object` to confirm |

## Use it in your project

Create a permanent `shelby` profile:

```bash
aws configure set aws_access_key_id "$SHELBY_ACCESS_KEY_ID" --profile shelby
aws configure set aws_secret_access_key "$SHELBY_SECRET_ACCESS_KEY" --profile shelby
aws configure set region default --profile shelby
aws configure set endpoint_url https://s3.beta.shelby.xyz --profile shelby
aws configure set s3.addressing_style path --profile shelby
aws configure set s3.multipart_chunksize 10MB --profile shelby
aws configure set request_checksum_calculation when_required --profile shelby
```

Then pass `--profile shelby`, or `export AWS_PROFILE=shelby`. Exported `AWS_ACCESS_KEY_ID`
and `AWS_SECRET_ACCESS_KEY` variables take precedence over a profile, so unset them if
they're set for another account.

`request_checksum_calculation` is required. AWS CLI 2.23 and later send uploads in
`aws-chunked` framing by default, which Shelby refuses with `501 NotImplemented`.

`s3.multipart_chunksize` uploads large files in 10 MiB parts, up from the CLI's default of
8 MiB. Each part counts as at least 10 MiB of storage, so smaller parts make a file count
as more than it holds. See [the 10 MiB minimum](https://docs.shelby.xyz/protocol/pricing#the-10-mib-minimum).

To let someone download an object without your credentials, presign a link. It works for
GET and HEAD, for up to 7 days (604800 seconds):

```bash
aws s3 presign "s3://$SHELBY_BUCKET/reports/q3.pdf" --expires-in 3600 --profile shelby
```

Anyone with the link can read that object until it expires, so treat it like a password
and keep it out of logs. Open it in a browser, or use it as a link or an `<img>` or
`<video>` source.

## What's different with the AWS CLI

- **Listings lag writes by a few seconds; reads don't.** `aws s3 ls`, `sync` and
  `rm --recursive` all work from listings, so they can miss an object written seconds ago.
- **`aws s3 mv`, and `aws s3 cp` from one Shelby key to another, fail.** Both need
  server-side copy. Download and upload again.
- **Presigned URLs are for downloads only.** `aws s3 presign` links work for GET and HEAD,
  and only when the profile's region is `default`. There are no presigned uploads, and
  you can't revoke one link: disabling the key revokes all of its links.
- **Files over about 29 GiB need a larger part size.** Shelby allows 3,000 parts per
  upload, and the profile above uses 10 MiB parts:
  `aws configure set s3.multipart_chunksize 64MB --profile shelby`.
- **A `401` shows no error code.** Shelby's authentication errors are plain text. Run with
  `--debug` to see the message, or run `make doctor`.

Docs: [AWS CLI quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/aws-cli) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
