# DuckDB

Write Parquet and CSV to Shelby from DuckDB, then query them in place.

## Run it

You need DuckDB 1.1 or later, and curl 7.75 or later for cleanup. From the repository
root, with `.env` filled in:

```bash
make duckdb                 # or: set -a; . ./.env; set +a; bash clients/duckdb/quickstart.sh
make duckdb ARGS=--large    # also writes a ~17 MiB Parquet file in parts
```

The script writes only under `quickstart/duckdb/<run-id>/` in your bucket, deletes what
it wrote, and exits 0 only when every step passes. DuckDB can't delete objects, so the
cleanup uses curl's built-in AWS signing.

## What it does

| Step | Shows |
| --- | --- |
| write | `COPY … TO 's3://…'` for Parquet, CSV and hive-partitioned Parquet, with `RETURN_FILES` to track what was written |
| read | `read_parquet` and `read_csv` on single files, checked against the same query run locally |
| glob | A glob over hive partitions, retried while the listing catches up |
| large | A multipart write within the 3,000-part limit (`--large` only) |
| delete | Signed `DELETE` requests with curl, then `HEAD` to confirm |

## Use it in your project

In the `duckdb` shell, with the variables from `.env` exported:

```sql
INSTALL httpfs;
LOAD httpfs;

CREATE SECRET shelby (
    TYPE s3,
    KEY_ID getenv('SHELBY_ACCESS_KEY_ID'),
    SECRET getenv('SHELBY_SECRET_ACCESS_KEY'),
    REGION 'default',
    ENDPOINT 's3.beta.shelby.xyz',
    URL_STYLE 'path'
);
SET s3_uploader_max_parts_per_file = 3000;

SELECT count(*) FROM read_parquet('s3://' || getenv('SHELBY_BUCKET') || '/data/*.parquet');
```

- **`URL_STYLE 'path'` is required.** The endpoint doesn't serve bucket names as
  hostnames.
- **`s3_uploader_max_parts_per_file = 3000`** matches Shelby's part limit. DuckDB divides
  `s3_uploader_max_filesize` (800GB by default) by it to size upload parts.
- **The secret is temporary** and lasts for the session. A `PERSISTENT` secret would
  store your credentials in plain text under `~/.duckdb`.

## What's different with DuckDB

- **Globs can miss files written in the last few seconds.** A glob lists the bucket, and
  listings lag writes. Reading a file by its exact path works straight away.
- **DuckDB can't delete objects.** Use another client, or a signed `DELETE` as the script
  does.
- **DuckDB only reads the byte ranges it needs**, so a query over a large Parquet file
  downloads a fraction of it.
- **Behind a proxy that needs credentials,** DuckDB can't parse
  `HTTPS_PROXY=http://user:pass@host:port` and fails with `Failed to parse http_proxy`.
  Start DuckDB without the proxy variables set, then set `http_proxy` (host and port),
  `http_proxy_username` and `http_proxy_password` with `SET`.

Docs: [DuckDB quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/duckdb) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility) ·
[Troubleshooting](https://docs.shelby.xyz/tools/s3-gateway/troubleshooting)
