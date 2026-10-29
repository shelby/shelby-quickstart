# Migrate from S3

Copy a dataset from Amazon S3 to Shelby with rclone, verify every file, and query the
copy in place with DuckDB.

## Run it

You need rclone 1.60 or later. DuckDB 1.1 or later is optional: with it, the run ends by
querying the copy. From the repository root, with `.env` filled in:

```bash
make migrate-from-s3    # or: set -a; . ./.env; set +a; bash recipes/migrate-from-s3/migrate.sh
```

The source is NOAA's daily weather records ([GHCN-Daily](https://registry.opendata.aws/noaa-ghcn/))
on AWS Open Data: temperature and rainfall for 1850 to 1859, 30 Parquet files, about 1 MB,
read without AWS credentials. The script uses a throwaway rclone config. It writes only
under `quickstart/migrate-from-s3/<run-id>/` in your bucket, deletes what it wrote, and
exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| remotes | An anonymous Amazon S3 source, and a Shelby destination |
| inventory | `rclone lsf` and `rclone size` with filters, to see what will move |
| copy | `rclone copy --checksum` from S3 to Shelby |
| list | Waiting for the copy to show up in listings |
| check | `rclone check --one-way`: every file matches the source by size and MD5 |
| query | The same DuckDB query against Amazon S3 and against Shelby, with identical results |
| delete | `rclone deletefile` on the keys the run tracked, then waiting for an empty listing |

## Migrate your own data

Configure a remote for your source as usual: Amazon S3, Cloudflare R2, MinIO or any S3
provider. Then copy it to a Shelby remote, set up as in [`clients/rclone`](../../clients/rclone):

```bash
rclone copy source:my-bucket "shelby:$SHELBY_BUCKET" --checksum --progress
rclone check source:my-bucket "shelby:$SHELBY_BUCKET" --one-way
```

- **Run it close to the source.** rclone streams every object through the machine it runs
  on, because Shelby can't copy server-side. For a large dataset, run it in the source's
  cloud region to keep transfer costs down.
- **Always pass `--checksum`.** It compares size and MD5 instead of modification times, so
  a rerun skips files that already arrived.
- **Run `check` after the listing catches up.** A file copied in the last few seconds can
  be missing from Shelby's listing and show up as a difference. Run it again.
- **Large files compare by size only.** Files uploaded in parts (over 200 MiB by default)
  have no whole-file MD5. For a byte-for-byte check, add `--download`.

## Query the copy in place

Scope the Shelby secret to your bucket, and DuckDB can read both sides in one session:

```sql
CREATE SECRET shelby (
    TYPE s3,
    KEY_ID getenv('SHELBY_ACCESS_KEY_ID'),
    SECRET getenv('SHELBY_SECRET_ACCESS_KEY'),
    REGION 'default',
    ENDPOINT 's3.beta.shelby.xyz',
    URL_STYLE 'path',
    SCOPE 's3://your-bucket-name/'
);
```

Paths under `s3://your-bucket-name/` use Shelby. Every other `s3://` path uses DuckDB's
default S3 settings.

Docs: [Migrating from S3](https://docs.shelby.xyz/tools/s3-gateway/migrating) ·
[rclone quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/rclone) ·
[DuckDB quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/duckdb)
