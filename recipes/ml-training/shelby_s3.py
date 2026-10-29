"""A boto3 client configured for Shelby's S3 API.

Copy this file into your project. Everything except the marked settings is a standard
boto3 client, so the rest of your S3 code stays the same.

Docs: https://docs.shelby.xyz/tools/s3-gateway/quickstarts/python (the same client as clients/python)
"""

import os

import boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get("SHELBY_S3_ENDPOINT", "https://s3.beta.shelby.xyz"),
    # The access key ID starts with SHLB. The secret is the value the console calls
    # your API key. They are two different values.
    aws_access_key_id=os.environ["SHELBY_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["SHELBY_SECRET_ACCESS_KEY"],
    region_name="default",
    config=Config(
        # The endpoint doesn't serve bucket names as hostnames.
        s3={"addressing_style": "path"},
        # botocore 1.36+ sends uploads as aws-chunked by default, which Shelby
        # refuses with 501 NotImplemented. This turns it off.
        request_checksum_calculation="when_required",
    ),
)

# Your one bucket. You can't create, delete or rename buckets on Shelby.
bucket = os.environ["SHELBY_BUCKET"]
