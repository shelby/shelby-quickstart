# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3>=1.36"]
# ///
"""Delete quickstart/ objects older than a day from the CI account's bucket.

Every example deletes what it wrote, even when a step fails, but a run that's killed
(a timeout, a cancelled job) can't. This runs nightly in CI to clear what such runs
left. It only touches keys under quickstart/, and only objects older than MAX_AGE, so
it never races a run in progress.

    uv run .github/scripts/sweep.py [--dry-run]
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import boto3
from botocore.config import Config

PREFIX = "quickstart/"
MAX_AGE = timedelta(days=1)
AGE = f"{MAX_AGE.total_seconds() / 3600:.0f}h"

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get("SHELBY_S3_ENDPOINT", "https://s3.beta.shelby.xyz"),
    aws_access_key_id=os.environ["SHELBY_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["SHELBY_SECRET_ACCESS_KEY"],
    region_name="default",
    config=Config(
        s3={"addressing_style": "path"},
        request_checksum_calculation="when_required",
    ),
)
bucket = os.environ["SHELBY_BUCKET"]

cutoff = datetime.now(timezone.utc) - MAX_AGE
stale = []
pages = s3.get_paginator("list_objects_v2").paginate(
    Bucket=bucket, Prefix=PREFIX, PaginationConfig={"PageSize": 1000}
)
for page in pages:
    stale += [o["Key"] for o in page.get("Contents", []) if o["LastModified"] < cutoff]
if not all(key.startswith(PREFIX) for key in stale):
    sys.exit(f"refusing to delete keys outside {PREFIX}")

if "--dry-run" in sys.argv:
    print(f"would sweep {len(stale)} object(s) older than {AGE} under {PREFIX}")
    for key in stale[:20]:
        print(f"  {key}")
    sys.exit(0)

failed = []
for i in range(0, len(stale), 1000):
    batch = [{"Key": key} for key in stale[i : i + 1000]]
    result = s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
    failed += result.get("Errors", [])

print(f"swept {len(stale) - len(failed)} object(s) older than {AGE} under {PREFIX}")
if failed:
    sys.exit(f"{len(failed)} delete(s) failed, first: {failed[0]}")
