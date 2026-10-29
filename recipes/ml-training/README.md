# ML training

Stream training data from Shelby, write checkpoints to Shelby, and resume training on
another machine from the last checkpoint. The data stays put while the compute moves.

## Run it

You need [uv](https://docs.astral.sh/uv/), which installs Python, boto3 and a CPU-only
PyTorch on the first run. From the repository root, with `.env` filled in:

```bash
make ml-training    # or: uv run --env-file .env recipes/ml-training/train.py
```

One run plays three parts, each with its own S3 client and no state shared in memory:
the job that prepares the dataset, a trainer on "machine A", and a trainer on "machine B"
that picks up where A stopped. The model is a single linear layer learning `y = 3x + 2`,
so the run takes seconds. It writes only under `quickstart/ml-training/<run-id>/` in your
bucket, deletes what it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| prepare | Shards written first, then a manifest that lists them with their SHA-256 |
| train-a | An `IterableDataset` streaming shards from the manifest, and checkpoints every 10 steps |
| resume-b | A fresh client finding the newest checkpoint through a `LATEST` pointer, with the loss in its `x-amz-meta-*` metadata |
| create-only | Writing an existing checkpoint step again is refused with `412` |
| train-b | Training continues from step 20 to step 40 |
| retention | Old checkpoints deleted explicitly, keeping the newest 2 |
| delete | Everything else the run wrote |

## The patterns, for your own training jobs

- **Readers use a manifest, not a listing.** Listings lag writes by a few seconds, so a
  trainer that lists the bucket can start without the newest shards. Write the shards,
  then a manifest naming them, and have trainers read the manifest. It's either complete
  or absent.
- **Each checkpoint gets its own key.** Shelby has no object versioning, so write
  `checkpoints/step-000100.pt`, not `checkpoints/latest.pt`.
- **Checkpoint writes are create-only.** `IfNoneMatch="*"` makes Shelby refuse a write to
  a key that already exists (`412 PreconditionFailed`), so two trainers can't overwrite
  each other's checkpoints.
- **A small pointer names the newest checkpoint.** Reads see an overwrite as soon as it
  returns, so a resuming trainer reads `LATEST` instead of listing checkpoints.
  `If-Match` isn't enforced yet, so give each run one writer for its pointer.
- **Metadata travels with the checkpoint.** The step and loss go in `x-amz-meta-*`, up to
  2 KB, so `head_object` can describe a checkpoint without downloading it.
- **Retention is your job.** Shelby has no lifecycle rules. Delete old checkpoints
  explicitly, by key.
- **One client per process.** With `DataLoader(num_workers > 0)`, create the S3 client
  inside each worker. boto3 clients can't be shared across processes.
- **Big checkpoints need a part size.** Over 5 GiB, a single `put_object` is refused. Use a
  multipart upload, and choose a part size for Shelby's 3,000-part limit (see
  [`clients/python`](../../clients/python)).

[`shelby_s3.py`](shelby_s3.py) is the same client as in `clients/python`.

Docs: [Python quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/python) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility)
