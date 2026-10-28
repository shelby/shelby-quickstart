# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3>=1.36"]
# ///
"""Store, read, list and delete objects on Shelby with boto3.

    uv run --env-file .env clients/python/quickstart.py [--large]

Everything it writes goes under quickstart/python/<run-id>/ in your bucket and is
deleted at the end, even if a step fails. Exits 0 only when every step passes.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import sys
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

REQUIRED = ("SHELBY_ACCESS_KEY_ID", "SHELBY_SECRET_ACCESS_KEY", "SHELBY_BUCKET")
CONSOLE = "https://console.shelby.xyz"
DOCS = "https://docs.shelby.xyz/tools/s3-gateway"
MiB = 1024 * 1024


class StepFailed(Exception):
    pass


def ok(step: str, detail: str) -> None:
    print(f"ok   {step}: {detail}", flush=True)


def fail(step: str, cause: str, fix: str) -> None:
    raise StepFailed(f"FAIL {step}: {cause} -> {fix}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def status_of(err: Exception) -> int | None:
    return (
        getattr(err, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode")
    )


def explain(step: str, err: Exception) -> str:
    """Turn a boto3 error into a FAIL line with a fix."""
    from botocore.exceptions import ClientError

    if not isinstance(err, ClientError):
        return f"FAIL {step}: {err} -> check your connection and SHELBY_S3_ENDPOINT"
    error = err.response.get("Error", {})
    code = error.get("Code", "")
    message = error.get("Message", "")
    status = status_of(err)
    if status == 401:
        # Shelby's 401s are plain text, so boto3 can't show the reason.
        cause, fix = "401 Unauthorized", "run `make doctor`, which shows the reason"
    elif code == "NotImplemented" and "aws-chunked" in message:
        cause = "501 aws-chunked uploads aren't supported"
        fix = "set request_checksum_calculation='when_required' (see shelby_s3.py)"
    elif code == "NotImplemented":
        cause, fix = (
            f"501 {message}",
            f"Shelby doesn't support this call; see {DOCS}/compatibility",
        )
    elif code == "NoSuchBucket":
        cause, fix = "404 NoSuchBucket", f"copy your bucket name from {CONSOLE}"
    elif code == "AccessDenied":
        cause, fix = "403 AccessDenied", "SHELBY_BUCKET must be your own bucket"
    else:
        cause, fix = f"{code or status} {message}", f"see {DOCS}/troubleshooting"
    return f"FAIL {step}: {cause} -> {fix}"


@contextmanager
def step(name: str) -> Iterator[None]:
    """Report any boto3 error raised inside the block as a failure of this step."""
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        yield
    except (ClientError, BotoCoreError) as err:
        raise StepFailed(explain(name, err)) from err


def run(s3, bucket: str, prefix: str, written: list[str], large: bool) -> None:
    from boto3.s3.transfer import TransferConfig
    from botocore.exceptions import ClientError

    key = prefix + "hello.txt"
    body = b"Hello, Shelby\n"

    with step("put"):
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="text/plain",
            Metadata={"example": "python"},
        )
        written.append(key)
    ok("put", key)

    # Reads see a new object as soon as the PUT returns. No waiter needed.
    with step("get"):
        data = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    if sha256(data) != sha256(body):
        fail("get", "the bytes read back don't match", "report this in Discord")
    ok("get", "read back immediately, SHA-256 matches")

    with step("head"):
        head = s3.head_object(Bucket=bucket, Key=key)
    stored = (head.get("ContentType"), head.get("Metadata", {}).get("example"))
    if stored != ("text/plain", "python"):
        fail("head", f"metadata came back as {stored}", "report this in Discord")
    ok("head", "Content-Type and x-amz-meta-* are stored")

    # Create-only writes are enforced. (If-Match on overwrite isn't yet.)
    with step("create-only"):
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=b"overwrite?", IfNoneMatch="*")
            overwrote = True
        except ClientError as err:
            if status_of(err) != 412:
                raise
            overwrote = False
    if overwrote:
        fail(
            "create-only",
            "If-None-Match: * overwrote an existing key",
            "don't rely on create-only writes until this passes",
        )
    ok("create-only", "If-None-Match: * refused to overwrite (412)")

    # Listings lag writes by a few seconds, so retry. Keep MaxKeys at 1,000 or less:
    # Shelby rejects larger page sizes instead of capping them.
    started = time.monotonic()
    while True:
        with step("list"):
            page = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1000)
        if key in {obj["Key"] for obj in page.get("Contents", [])}:
            break
        if time.monotonic() - started > 30:
            fail(
                "list",
                f"{key} isn't listed after 30s",
                "retry; listings usually catch up in seconds",
            )
        time.sleep(1)
    ok("list", f"listed after {time.monotonic() - started:.0f}s")

    if large:
        # Shelby allows 3,000 parts per upload, so the part size sets your largest
        # file: 8 MiB (the default) gives about 23 GiB, 64 MiB about 187 GiB.
        # 5 MiB parts here make a 12 MiB file upload in 3 parts.
        config = TransferConfig(
            multipart_threshold=5 * MiB, multipart_chunksize=5 * MiB
        )
        large_key = prefix + "large.bin"
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp, "large.bin"), Path(tmp, "large-copy.bin")
            src.write_bytes(os.urandom(12 * MiB))
            with step("large"):
                s3.upload_file(str(src), bucket, large_key, Config=config)
                written.append(large_key)
                etag = s3.head_object(Bucket=bucket, Key=large_key)["ETag"].strip('"')
                s3.download_file(bucket, large_key, str(dst), Config=config)
            if sha256(src.read_bytes()) != sha256(dst.read_bytes()):
                fail(
                    "large",
                    "the downloaded file doesn't match",
                    "report this in Discord",
                )
        ok("large", f"12 MiB in 5 MiB parts (ETag {etag}), downloaded and matched")

    # Delete the keys this run wrote. Tracking them, rather than listing the prefix,
    # avoids missing objects that haven't reached the listing yet.
    with step("delete"):
        result = s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in written], "Quiet": True},
        )
    if result.get("Errors"):
        fail(
            "delete",
            f"some deletes failed: {result['Errors']}",
            f"see {DOCS}/troubleshooting",
        )
    for k in written:
        with step("delete"):
            try:
                s3.head_object(Bucket=bucket, Key=k)
                still_there = True
            except ClientError as err:
                if status_of(err) != 404:
                    raise
                still_there = False
        if still_there:
            fail("delete", f"{k} still exists after delete", "report this in Discord")
    ok("delete", f"deleted {len(written)} object(s), HEAD confirms they're gone")
    written.clear()


def cleanup(s3, bucket: str, written: list[str]) -> None:
    """Best effort, after a failure: delete whatever this run left behind."""
    if not written:
        return
    try:
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in written], "Quiet": True},
        )
        print(f"cleanup: deleted {len(written)} object(s) left by the failed run")
    except Exception as err:  # noqa: BLE001 - report and move on
        print(f"cleanup: couldn't delete {written}: {err}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--large", action="store_true", help="add a 12 MiB multipart upload"
    )
    args = parser.parse_args()

    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        print(
            f"FAIL env: missing {', '.join(missing)} -> copy .env.example to .env and fill it in from {CONSOLE}"
        )
        print("RESULT fail")
        return 1

    from shelby_s3 import bucket, s3

    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + secrets.token_hex(2)
    )
    prefix = f"quickstart/python/{run_id}/"
    written: list[str] = []
    try:
        run(s3, bucket, prefix, written, args.large)
    except Exception as err:  # noqa: BLE001 - report any failure, then clean up
        if isinstance(err, StepFailed):
            print(err)
        else:
            print(f"FAIL unexpected: {err!r} -> report this in Discord")
        cleanup(s3, bucket, written)
        print("RESULT fail")
        return 1
    print("RESULT ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
