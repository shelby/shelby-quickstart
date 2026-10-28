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
aws configure set request_checksum_calculation when_required --profile shelby
```

Then pass `--profile shelby`, or `export AWS_PROFILE=shelby`. Exported `AWS_ACCESS_KEY_ID`
and `AWS_SECRET_ACCESS_KEY` variables take precedence over a profile, so unset them if
they're set for another account.

`request_checksum_calculation` is required. AWS CLI 2.23 and later send uploads in
`aws-chunked` framing by default, which Shelby refuses with `501 NotImplemented`.

## What's different with the AWS CLI

- **Listings lag writes by a few seconds; reads don't.** `aws s3 ls`, `sync` and
  `rm --recursive` all work from listings, so they can miss an object written seconds ago.
- **`aws s3 mv`, and `aws s3 cp` from one Shelby key to another, fail.** Both need
  server-side copy. Download and upload again.
- **Files over about 23 GiB need a larger part size.** Shelby allows 3,000 parts per
  upload, and the CLI's default part size is 8 MiB:
  `aws configure set s3.multipart_chunksize 64MB --profile shelby`.
- **A `401` shows no error code.** Shelby's authentication errors are plain text. Run with
  `--debug` to see the message, or run `make doctor`.

Docs: [AWS CLI quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/aws-cli) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
