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
| presign | `generate_presigned_url` for a link that expires in 300 s, read by `urllib` with no credentials |
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
    aws_secret_access_key=os.environ["SHELBY_SECRET_ACCESS_KEY"],  # the same access key's secret
    region_name="default",
    config=Config(
        s3={"addressing_style": "path"},
        request_checksum_calculation="when_required",
    ),
)
```

`request_checksum_calculation` is required. botocore 1.36 and later send uploads in
`aws-chunked` framing by default, which Shelby refuses with `501 NotImplemented`.

To let someone download an object without your credentials, presign a link on your
server. It works for `get_object` and `head_object`, for up to 7 days (604800 seconds):

```python
url = s3.generate_presigned_url(
    "get_object", Params={"Bucket": bucket, "Key": "reports/q3.pdf"}, ExpiresIn=3600
)
```

Anyone with the link can read that object until it expires, so treat it like a password
and keep it out of logs. A browser can open it, or use it as a link or an `<img>` or
`<video>` source.

## What's different with boto3

- **Listings lag writes by a few seconds; reads don't.** Confirm a write with
  `get_object` or `head_object`, and track the keys you wrote instead of listing them.
- **`copy_object` and `s3.copy` fail with `501`.** There's no server-side copy. Download
  and upload again.
- **Presign with region `default`.** With it, boto3 signs with SigV4. A client set to
  `us-east-1` presigns the legacy SigV2 way, which Shelby refuses with `401`. Presigned
  URLs work for `get_object` and `head_object` only: there are no presigned uploads.
- **Paginators need `PageSize` of 1,000 or less.** Larger values are rejected, not capped.
- **Use parts of at least 10 MiB, sized for the 3,000-part limit.** Each part counts as at
  least 10 MiB of storage ([the 10 MiB minimum](https://docs.shelby.xyz/protocol/pricing#the-10-mib-minimum)), and at
  the default 8 MiB, files over about 23 GiB also fail partway. Use
  `TransferConfig(multipart_chunksize=64 * 1024 * 1024)` for files up to about 187 GiB.
- **A `401` shows no error code.** Shelby's authentication errors are plain text. Run
  `make doctor` to see the reason.
- **`x-amz-meta-*` is capped at 2 KB**, as on S3.

Docs: [Python quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/python) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
