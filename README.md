# Shelby quickstart

Runnable examples for [Shelby](https://shelby.xyz)'s S3-compatible API. Each one stores,
reads, lists and deletes objects in your bucket, checks its own results, and cleans up
after itself.

> Looking for the version built on the Shelby SDK and CLI? It's tagged
> [`v1.0.2`](https://github.com/shelby/shelby-quickstart/tree/v1.0.2). The SDK and CLI
> are deprecated in favour of the S3 API.

## Point your agent here

Paste this into Claude Code, Cursor or Codex:

```text
Add Shelby storage to this project using https://github.com/shelby/shelby-quickstart.
Read its AGENTS.md first, and follow the example for our stack.
```

## Set up

You need `bash`, `curl` and `make`, plus the client you want to try. On Windows, use WSL.

1. Get your access key ID, API key and bucket name at
   [console.shelby.xyz](https://console.shelby.xyz).
2. Copy `.env.example` to `.env` and fill in the three values.
3. Run `make doctor`. It checks your credentials, bucket, clock and tools without writing
   anything.

## Connection settings

| Setting | Value |
| --- | --- |
| Endpoint | `https://s3.beta.shelby.xyz` |
| Access key ID | Your access key ID (starts with `SHLB`) |
| Secret access key | Your API key |
| Bucket | Your bucket name, for example `shelby-managed-account-1` |
| Region | `default` |
| Addressing | Path-style |

## Examples

| Client | Run | Folder |
| --- | --- | --- |
| AWS CLI v2 | `make aws-cli` | [`clients/aws-cli`](clients/aws-cli) |
| Python (boto3) | `make python` | [`clients/python`](clients/python) |
| JavaScript (AWS SDK v3) | `make javascript` | [`clients/javascript`](clients/javascript) |
| rclone | `make rclone` | [`clients/rclone`](clients/rclone) |
| DuckDB | `make duckdb` | [`clients/duckdb`](clients/duckdb) |

Add `ARGS=--large` to include a multipart upload.

## Recipes

| Recipe | Run | Shows |
| --- | --- | --- |
| [Migrate from S3](recipes/migrate-from-s3) | `make migrate-from-s3` | Copy a public dataset from Amazon S3 with rclone, verify every file, then get the same DuckDB query result from both sides |
| [ML training](recipes/ml-training) | `make ml-training` | Stream shards into PyTorch, checkpoint to Shelby, and resume on another machine |

Every example and recipe writes only under `quickstart/<name>/<run-id>/` in your bucket
and deletes what it wrote. `make all` runs `doctor` and then all of them.

## Learn more

- [Shelby S3 API docs](https://docs.shelby.xyz/tools/s3-gateway)
- [How Shelby differs from S3](https://docs.shelby.xyz/tools/s3-gateway#how-shelby-differs-from-s3)
- [Compatibility matrix](https://docs.shelby.xyz/tools/s3-gateway/compatibility)
- [Discord](https://discord.gg/shelbyserves)

## License

[MIT](LICENSE)
