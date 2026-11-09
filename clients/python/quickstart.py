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
import re
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.request
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
        cause, fix = (
            "403 AccessDenied",
            "SHELBY_BUCKET must be the bucket this access key belongs to",
        )
    else:
        cause, fix = f"{code or status} {message}", f"see {DOCS}/troubleshooting"
    return f"FAIL {step}: {cause} -> {fix}"


def explain_presigned(step: str, status: int, body: str) -> str:
    """Turn a refused presigned request into a FAIL line with a fix.

    Shelby gives the reason as plain text, not S3 XML.
    """
    text = body.strip()
    if text.startswith("<"):
        # Errors from further in, such as 404 NoSuchKey, are S3 XML. Keep the code.
        match = re.search(r"<Code>(\w+)</Code>", text)
        reason = match.group(1) if match else ""
    else:
        reason = text.splitlines()[0].split(". ")[0][:200] if text else ""
    if status == 401 and "expired" in reason:
        fix = "sign a new link, and check your clock with `make doctor`"
    elif status == 401 and "Anonymous" in reason:
        fix = "sign with region_name='default'; for us-east-1 boto3 signs with SigV2"
    elif status == 401 and "AccessKeyId" in reason:
        fix = f"sign with the SHLB access key ID from {CONSOLE}"
    elif status == 401:
        fix = (
            "sign with region 'default' and the secret that matches the key,"
            " and don't change the URL after signing"
        )
    elif status == 400 and "region" in reason:
        fix = "sign with region_name='default'"
    elif status == 400 and "not supported" in reason:
        fix = (
            "drop ResponseCacheControl and ResponseExpires;"
            " the other Response* overrides work"
        )
    elif status == 400 and "X-Amz-Expires" in reason:
        fix = "set ExpiresIn between 1 and 604800 seconds (7 days)"
    elif status == 405:
        fix = (
            "presign get_object or head_object only,"
            " and upload from a server with your credentials"
        )
    elif status == 503:
        fix = "too many downloads at once; retry after the Retry-After delay"
    else:
        fix = f"see {DOCS}/troubleshooting"
    cause = f"{status} {reason}" if reason else str(status)
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

    # A presigned URL lets someone with no credentials read one object until it
    # expires. On Shelby it's read-only: presign get_object or head_object for one
    # key, for at most 7 days (604800 s), on a server. It's signed with the client's
    # region "default" and path-style addressing (see shelby_s3.py). With region
    # us-east-1, boto3 presigns the legacy SigV2 way, which Shelby refuses with 401.
    expires = 300
    with step("presign"):
        url = s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires
        )
    # The URL is a bearer credential: anyone who has it can read the object until it
    # expires. Never log it. Here a plain HTTP client reads it, with no credentials.
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            shared = response.read()
            cache_control = response.headers.get("Cache-Control", "")
    except urllib.error.HTTPError as err:
        body_text = err.read().decode(errors="replace")
        raise StepFailed(explain_presigned("presign", err.code, body_text)) from None
    except urllib.error.URLError as err:
        fail("presign", str(err.reason), "check your connection and SHELBY_S3_ENDPOINT")
    if sha256(shared) != sha256(body):
        fail(
            "presign",
            "the bytes fetched through the link don't match",
            "report this in Discord",
        )
    # Every presigned response says Cache-Control: private, no-store, so browsers and
    # CDNs don't keep a copy. Don't put a CDN in front of these links.
    if "no-store" not in cache_control:
        fail(
            "presign",
            f"Cache-Control is {cache_control!r}, without no-store",
            "report this in Discord",
        )
    ok(
        "presign",
        f"fetched {len(shared)} bytes through a link valid for {expires} s,"
        " without credentials",
    )

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
