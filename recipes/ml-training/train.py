# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3>=1.36", "numpy", "torch>=2.4"]
#
# # CPU-only PyTorch: the default Linux wheel bundles CUDA and is several GB.
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Train from shards on Shelby, checkpoint to Shelby, and resume from another machine.

    uv run --env-file .env recipes/ml-training/train.py

One run plays three parts, each with its own S3 client and no state shared in memory:
the job that prepares the dataset, a trainer on "machine A", and a trainer on "machine
B" that resumes from A's last checkpoint. Everything it writes goes under
quickstart/ml-training/<run-id>/ in your bucket and is deleted at the end, even if a
step fails. Exits 0 only when every step passes.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

REQUIRED = ("SHELBY_ACCESS_KEY_ID", "SHELBY_SECRET_ACCESS_KEY", "SHELBY_BUCKET")
CONSOLE = "https://console.shelby.xyz"
DOCS = "https://docs.shelby.xyz/tools/s3-gateway"

SHARDS, SAMPLES_PER_SHARD, BATCH = 4, 256, 32
CHECKPOINT_EVERY, KEEP_CHECKPOINTS = 10, 2


class StepFailed(Exception):
    pass


def ok(step: str, detail: str) -> None:
    print(f"ok   {step}: {detail}", flush=True)


def fail(step: str, cause: str, fix: str) -> None:
    raise StepFailed(f"FAIL {step}: {cause} -> {fix}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def status_of(err: Exception) -> int | None:
    meta = getattr(err, "response", {}).get("ResponseMetadata", {})
    return meta.get("HTTPStatusCode")


def explain(step: str, err: Exception) -> str:
    """Turn a boto3 error into a FAIL line with a fix."""
    from botocore.exceptions import ClientError

    if not isinstance(err, ClientError):
        return f"FAIL {step}: {err} -> check your connection and SHELBY_S3_ENDPOINT"
    error = err.response.get("Error", {})
    code, message, status = (
        error.get("Code", ""),
        error.get("Message", ""),
        status_of(err),
    )
    if status == 401:
        cause, fix = "401 Unauthorized", "run `make doctor`, which shows the reason"
    elif code == "NotImplemented" and "aws-chunked" in message:
        cause = "501 aws-chunked uploads aren't supported"
        fix = "set request_checksum_calculation='when_required' (see shelby_s3.py)"
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


def new_client():
    """A fresh client, as a separate job or machine would have."""
    import importlib

    import shelby_s3

    return importlib.reload(shelby_s3).s3


# ---------- the dataset ------------------------------------------------------


def prepare_data(s3, bucket: str, prefix: str, written: list[str]) -> None:
    """Write the dataset as shards, then a manifest that lists them.

    The manifest goes last, and trainers read it instead of listing the bucket.
    Listings lag writes by a few seconds, so a trainer that listed could start
    without the newest shards. A manifest is complete or absent.
    """
    import torch

    torch.manual_seed(0)
    manifest = {"shards": []}
    for i in range(SHARDS):
        x = torch.rand(SAMPLES_PER_SHARD, 1) * 2 - 1
        y = 3 * x + 2 + 0.05 * torch.randn(SAMPLES_PER_SHARD, 1)  # learn y = 3x + 2
        buffer = io.BytesIO()
        torch.save({"x": x, "y": y}, buffer)
        body = buffer.getvalue()
        key = f"{prefix}data/shard-{i:04d}.pt"
        s3.put_object(Bucket=bucket, Key=key, Body=body)
        written.append(key)
        manifest["shards"].append(
            {"key": key, "samples": SAMPLES_PER_SHARD, "sha256": sha256(body)}
        )
    key = f"{prefix}data/manifest.json"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(manifest).encode(),
        ContentType="application/json",
    )
    written.append(key)


def batches(s3, bucket: str, prefix: str):
    """Stream batches from the shards in the manifest, epoch after epoch.

    With DataLoader(num_workers > 0), create the S3 client inside each worker:
    boto3 clients can't be shared across processes.
    """
    import torch
    from torch.utils.data import DataLoader, IterableDataset

    body = s3.get_object(Bucket=bucket, Key=f"{prefix}data/manifest.json")["Body"]
    shards = json.loads(body.read())["shards"]

    class ShardStream(IterableDataset):
        def __iter__(self):
            for shard in shards:
                data = s3.get_object(Bucket=bucket, Key=shard["key"])["Body"].read()
                if sha256(data) != shard["sha256"]:
                    raise ValueError(f"{shard['key']} doesn't match the manifest")
                tensors = torch.load(io.BytesIO(data), weights_only=True)
                yield from zip(tensors["x"], tensors["y"], strict=True)

    while True:
        yield from DataLoader(ShardStream(), batch_size=BATCH)


# ---------- checkpoints ------------------------------------------------------


def save_checkpoint(s3, bucket, prefix, step_no, model, optimizer, loss, written):
    """Write a checkpoint to an immutable key, then point LATEST at it.

    Shelby has no object versioning, so each checkpoint gets its own key, and
    If-None-Match: * makes the write create-only: if another trainer already wrote
    this step, the write is refused with 412 instead of replacing it.
    """
    import torch

    buffer = io.BytesIO()
    state = {
        "step": step_no,
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
    }
    torch.save(state, buffer)
    key = f"{prefix}checkpoints/step-{step_no:06d}.pt"
    # Checkpoints over 5 GiB need a multipart upload. Shelby allows 3,000 parts, so
    # choose a part size for your largest checkpoint (see clients/python).
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=buffer.getvalue(),
        IfNoneMatch="*",
        Metadata={"step": str(step_no), "loss": f"{loss:.4f}"},
    )
    written.append(key)
    # A small pointer, overwritten after each checkpoint. Reads see an overwrite as
    # soon as it returns, so a resuming trainer never needs to list checkpoints. With
    # one trainer per run this is safe; If-Match isn't enforced yet, so don't let two
    # trainers race on the same pointer.
    latest = f"{prefix}checkpoints/LATEST"
    s3.put_object(Bucket=bucket, Key=latest, Body=key.encode())
    if latest not in written:
        written.append(latest)
    return key


def train(s3, bucket, prefix, model, optimizer, start, stop, written):
    """Train from step `start` to `stop`, checkpointing every CHECKPOINT_EVERY steps."""
    import torch

    loss_fn = torch.nn.MSELoss()
    stream = batches(s3, bucket, prefix)
    first_loss = loss = None
    saved = []
    for step_no in range(start + 1, stop + 1):
        x, y = next(stream)
        optimizer.zero_grad()
        loss_value = loss_fn(model(x), y)
        loss_value.backward()
        optimizer.step()
        loss = loss_value.item()
        first_loss = loss if first_loss is None else first_loss
        if step_no % CHECKPOINT_EVERY == 0:
            saved.append(
                save_checkpoint(
                    s3, bucket, prefix, step_no, model, optimizer, loss, written
                )
            )
    return first_loss, loss, saved


def new_model():
    import torch

    torch.manual_seed(1)
    model = torch.nn.Linear(1, 1)
    return model, torch.optim.SGD(model.parameters(), lr=0.1)


# ---------- the run ----------------------------------------------------------


def run(bucket: str, prefix: str, written: list[str]) -> None:
    import torch
    from botocore.exceptions import ClientError

    with step("prepare"):
        prepare_data(new_client(), bucket, prefix, written)
    ok(
        "prepare",
        f"{SHARDS} shards ({SHARDS * SAMPLES_PER_SHARD} samples), manifest last",
    )

    # Machine A trains for 20 steps.
    model, optimizer = new_model()
    with step("train-a"):
        first, last, saved = train(
            new_client(), bucket, prefix, model, optimizer, 0, 20, written
        )
    ok(
        "train-a",
        f"steps 1-20, loss {first:.3f} -> {last:.3f}, checkpoints {len(saved)}",
    )

    # Machine B starts from nothing but the bucket: LATEST names the checkpoint.
    s3 = new_client()
    with step("resume-b"):
        latest = f"{prefix}checkpoints/LATEST"
        key = s3.get_object(Bucket=bucket, Key=latest)["Body"].read().decode()
        meta = s3.head_object(Bucket=bucket, Key=key)["Metadata"]
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    state = torch.load(io.BytesIO(body), weights_only=True)
    model, optimizer = new_model()
    model.load_state_dict(state["model"])
    optimizer.load_state_dict(state["optimizer"])
    if state["step"] != 20 or meta.get("step") != "20":
        fail(
            "resume-b",
            f"LATEST pointed at step {state['step']}",
            "report this in Discord",
        )
    ok(
        "resume-b",
        f"found step 20 through LATEST, loss {meta.get('loss')} (from x-amz-meta-loss)",
    )

    # Writing step 20 again must not replace A's checkpoint.
    with step("create-only"):
        try:
            save_checkpoint(s3, bucket, prefix, 20, model, optimizer, 0.0, [])
            overwrote = True
        except ClientError as err:
            if status_of(err) != 412:
                raise
            overwrote = False
    if overwrote:
        fail(
            "create-only",
            "a second write of step 20 replaced it",
            "report this in Discord",
        )
    ok("create-only", "a second write of step 20 was refused (412)")

    with step("train-b"):
        first, last, saved = train(
            s3, bucket, prefix, model, optimizer, 20, 40, written
        )
    weight, bias = model.weight.item(), model.bias.item()
    if abs(weight - 3) > 0.5 or abs(bias - 2) > 0.5:
        fail(
            "train-b",
            f"learned y = {weight:.2f}x + {bias:.2f}",
            "report this in Discord",
        )
    ok(
        "train-b",
        f"steps 21-40, loss {first:.3f} -> {last:.3f}, learned y = {weight:.2f}x + {bias:.2f}",
    )

    # Shelby has no lifecycle rules, so old checkpoints stay until you delete them.
    checkpoints = sorted(k for k in written if "/checkpoints/step-" in k)
    expired = checkpoints[:-KEEP_CHECKPOINTS]
    with step("retention"):
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in expired], "Quiet": True},
        )
    for k in expired:
        written.remove(k)
    ok(
        "retention",
        f"kept the {KEEP_CHECKPOINTS} newest checkpoints, deleted {len(expired)}",
    )

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
    ok("delete", f"deleted the remaining {len(written)} object(s)")
    written.clear()


def cleanup(bucket: str, written: list[str]) -> None:
    """Best effort, after a failure: delete whatever this run left behind."""
    if not written:
        return
    try:
        new_client().delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in written], "Quiet": True},
        )
        print(f"cleanup: deleted {len(written)} object(s) left by the failed run")
    except Exception as err:  # noqa: BLE001 - report and move on
        print(f"cleanup: couldn't delete {written}: {err}")


def main() -> int:
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        print(
            f"FAIL env: missing {', '.join(missing)} -> copy .env.example to .env "
            f"and fill it in from {CONSOLE}"
        )
        print("RESULT fail")
        return 1

    bucket = os.environ["SHELBY_BUCKET"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix = f"quickstart/ml-training/{stamp}-{secrets.token_hex(2)}/"
    written: list[str] = []
    try:
        run(bucket, prefix, written)
    except Exception as err:  # noqa: BLE001 - report any failure, then clean up
        print(
            err
            if isinstance(err, StepFailed)
            else f"FAIL unexpected: {err!r} -> report this in Discord"
        )
        cleanup(bucket, written)
        print("RESULT fail")
        return 1
    print("RESULT ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
