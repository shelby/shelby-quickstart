# Python (boto3)

Store, read, list and delete objects on Shelby with boto3.

## Run it

From the repository root, with `.env` filled in:

```bash
make python                 # or: uv run --env-file .env clients/python/quickstart.py
make python ARGS=--large    # also uploads a 12 MiB file in parts
```

Without uv, install `boto3>=1.36`, export the variables from `.env`, and run
`python3 clients/python/quickstart.py`.

The script writes only under `quickstart/python/<run-id>/` in your bucket, deletes what
it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| put | An upload with `ContentType` and `Metadata` |
| get | Reading the object straight back. No waiter needed. |
| head | `Content-Type` and `x-amz-meta-*` are stored |
| create-only | `IfNoneMatch="*"` refuses to overwrite an existing key (`412`) |
| list | Retrying while the listing catches up, with `MaxKeys` at 1,000 |
| large | `upload_file` with an explicit part size (`--large` only) |
| delete | `delete_objects` on the keys the run tracked, then `head_object` to confirm |

## Use it in your project

Copy [`shelby_s3.py`](shelby_s3.py) and import `s3` and `bucket` from it. It's a standard
boto3 client with these settings:

```python
s3 = boto3.client(
    "s3",
    endpoint_url="https://s3.beta.shelby.xyz",
    aws_access_key_id=os.environ["SHELBY_ACCESS_KEY_ID"],          # starts with SHLB
    aws_secret_access_key=os.environ["SHELBY_SECRET_ACCESS_KEY"],  # the console's "API key"
    region_name="default",
    config=Config(
        s3={"addressing_style": "path"},
        request_checksum_calculation="when_required",
    ),
)
```

`request_checksum_calculation` is required. botocore 1.36 and later send uploads in
`aws-chunked` framing by default, which Shelby refuses with `501 NotImplemented`.

## What's different with boto3

- **Listings lag writes by a few seconds; reads don't.** Confirm a write with
  `get_object` or `head_object`, and track the keys you wrote instead of listing them.
- **`copy_object` and `s3.copy` fail with `501`.** There's no server-side copy. Download
  and upload again.
- **Paginators need `PageSize` of 1,000 or less.** Larger values are rejected, not capped.
- **Choose a part size for the 3,000-part limit.** At the default 8 MiB, files over about
  23 GiB fail partway. Use `TransferConfig(multipart_chunksize=64 * 1024 * 1024)` for
  files up to about 187 GiB.
- **A `401` shows no error code.** Shelby's authentication errors are plain text. Run
  `make doctor` to see the reason.
- **`x-amz-meta-*` is capped at 2 KB**, as on S3.

Docs: [Python quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/python) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
