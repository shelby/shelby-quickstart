#!/usr/bin/env bash
# Store, read, list, sync and delete objects on Shelby with the AWS CLI.
#
#   make aws-cli [ARGS=--large]
#   or: set -a; . ./.env; set +a; bash clients/aws-cli/quickstart.sh [--large]
#
# Everything it writes goes under quickstart/aws-cli/<run-id>/ in your bucket and is
# deleted at the end, even if a step fails. It uses a throwaway AWS config, so your
# ~/.aws files are never read or changed. Exits 0 only when every step passes.
set -euo pipefail

ENDPOINT="${SHELBY_S3_ENDPOINT:-https://s3.beta.shelby.xyz}"
CONSOLE="https://console.shelby.xyz"
DOCS="https://docs.shelby.xyz/tools/s3-gateway"
LARGE=false
if [ "${1:-}" = --large ]; then LARGE=true; fi

# Results go to the original stdout (fd 3), whatever a step redirects.
exec 3>&1
current="env"
reported=false
written="" # keys this run wrote, space-separated
tmp=""

ok() { printf 'ok   %s: %s\n' "$current" "$1" >&3; }

fail() { # cause, fix
  printf 'FAIL %s: %s -> %s\n' "$current" "$1" "$2" >&3
  reported=true
  exit 1
}

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# Map an AWS CLI error (its stderr, in a file) to a FAIL line with a fix.
explain_and_fail() {
  local msg
  msg=$(tr -d '\r' <"$1" | grep -v '^$' | tail -1)
  case "$msg" in
  *aws-chunked*) fail "501: aws-chunked uploads aren't supported" "set request_checksum_calculation = when_required in the profile" ;;
  *"(401)"* | *Unauthorized*) fail "401 Unauthorized" "run make doctor, which shows the reason" ;;
  *NoSuchBucket*) fail "404 NoSuchBucket" "copy your bucket name from $CONSOLE" ;;
  *AccessDenied*) fail "403 AccessDenied" "SHELBY_BUCKET must be your own bucket" ;;
  *NotImplemented*) fail "501: $msg" "Shelby doesn't support this call; see $DOCS/compatibility" ;;
  *) fail "${msg:-the AWS CLI failed}" "see $DOCS/troubleshooting" ;;
  esac
}

aws_or_fail() {
  aws "$@" 2>"$tmp/stderr" || explain_and_fail "$tmp/stderr"
}

write_delete_request() { # the keys in $written, as a DeleteObjects body
  local key sep=""
  {
    printf '{"Objects":['
    for key in $written; do
      printf '%s{"Key":"%s"}' "$sep" "$key"
      sep=,
    done
    printf '],"Quiet":true}'
  } >"$tmp/delete.json"
}

# Wait until a listing of $1 shows $2 entries. Listings lag writes by a few seconds.
# aws s3 ls exits 1 on an empty listing, so only stderr output counts as an error.
wait_for_listing() { # prefix, expected count
  local started count
  started=$(date +%s)
  while :; do
    aws s3 ls "s3://$BUCKET/$1" >"$tmp/ls" 2>"$tmp/stderr" || true
    if [ -s "$tmp/stderr" ]; then explain_and_fail "$tmp/stderr"; fi
    count=$(grep -c . "$tmp/ls" || true)
    if [ "$count" -ge "$2" ]; then break; fi
    if [ $(($(date +%s) - started)) -ge 30 ]; then
      fail "only $count of $2 objects listed after 30s" "retry; listings usually catch up in seconds"
    fi
    sleep 1
  done
  waited=$(($(date +%s) - started))
}

on_exit() {
  local status=$?
  if [ -n "$written" ] && [ -n "$tmp" ]; then
    write_delete_request
    if aws s3api delete-objects --bucket "$BUCKET" --delete "file://$tmp/delete.json" >/dev/null 2>&1; then
      echo "cleanup: deleted the objects left by the failed run" >&3
    else
      echo "cleanup: couldn't delete $written" >&3
    fi
  fi
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
  if [ "$status" -eq 0 ]; then
    echo "RESULT ok" >&3
  else
    if [ "$reported" = false ]; then
      printf 'FAIL %s: stopped with exit status %s -> see the output above\n' "$current" "$status" >&3
    fi
    echo "RESULT fail" >&3
  fi
}
trap on_exit EXIT

# ---------- setup ------------------------------------------------------------

missing=""
for name in SHELBY_ACCESS_KEY_ID SHELBY_SECRET_ACCESS_KEY SHELBY_BUCKET; do
  if [ -z "${!name:-}" ]; then missing="$missing $name"; fi
done
if [ -n "$missing" ]; then
  fail "missing:$missing" "copy .env.example to .env and fill it in from $CONSOLE"
fi
command -v aws >/dev/null ||
  fail "the AWS CLI isn't installed" "install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"

current="setup"
BUCKET="$SHELBY_BUCKET"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/shelby-quickstart.XXXXXX") # macOS ignores TMPDIR without a template
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
prefix="quickstart/aws-cli/$run_id"

current="profile"
# A throwaway config file, and no AWS_* variables from your shell: those would take
# precedence over the profile.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE \
  AWS_DEFAULT_PROFILE AWS_REGION AWS_DEFAULT_REGION AWS_ENDPOINT_URL \
  AWS_ENDPOINT_URL_S3 AWS_REQUEST_CHECKSUM_CALCULATION AWS_RESPONSE_CHECKSUM_VALIDATION
export AWS_CONFIG_FILE="$tmp/config" AWS_SHARED_CREDENTIALS_FILE="$tmp/credentials"
export AWS_PAGER=""

# The same commands set up a permanent profile. See README.md.
aws configure set aws_access_key_id "$SHELBY_ACCESS_KEY_ID" --profile shelby
aws configure set aws_secret_access_key "$SHELBY_SECRET_ACCESS_KEY" --profile shelby
aws configure set region default --profile shelby
aws configure set endpoint_url "$ENDPOINT" --profile shelby
aws configure set s3.addressing_style path --profile shelby
# AWS CLI 2.23+ sends uploads as aws-chunked by default, which Shelby refuses with
# 501 NotImplemented. This turns it off.
aws configure set request_checksum_calculation when_required --profile shelby
export AWS_PROFILE=shelby
ok "throwaway shelby profile configured ($(aws --version 2>&1 | cut -d' ' -f1))"

# ---------- steps ------------------------------------------------------------

current="put"
printf 'Hello, Shelby\n' >"$tmp/hello.txt"
aws_or_fail s3 cp "$tmp/hello.txt" "s3://$BUCKET/$prefix/hello.txt" --only-show-errors
written="$written $prefix/hello.txt"
ok "$prefix/hello.txt"

current="get"
# Reads see a new object as soon as the upload returns.
aws_or_fail s3 cp "s3://$BUCKET/$prefix/hello.txt" "$tmp/hello-copy.txt" --only-show-errors
if [ "$(sha256 "$tmp/hello.txt")" != "$(sha256 "$tmp/hello-copy.txt")" ]; then
  fail "the bytes read back don't match" "report this in Discord"
fi
ok "read back immediately, SHA-256 matches"

current="list"
wait_for_listing "$prefix/" 1
ok "listed after ${waited}s"

current="sync"
mkdir "$tmp/data"
for n in 1 2 3; do printf 'file %s\n' "$n" >"$tmp/data/file$n.txt"; done
# sync skips files whose remote copy is newer. Backdating the local files makes that
# comparison clear-cut, since timestamps are compared to the second.
touch -t 202001010000 "$tmp"/data/*.txt
aws_or_fail s3 sync "$tmp/data" "s3://$BUCKET/$prefix/data/" --only-show-errors
written="$written $prefix/data/file1.txt $prefix/data/file2.txt $prefix/data/file3.txt"
# sync compares against a listing, so let the listing catch up before syncing again.
wait_for_listing "$prefix/data/" 3
aws_or_fail s3 sync "$tmp/data" "s3://$BUCKET/$prefix/data/" --dryrun >"$tmp/resync"
if [ -s "$tmp/resync" ]; then
  fail "a second sync wanted to upload again: $(head -1 "$tmp/resync")" "report this in Discord"
fi
ok "3 files synced, and a second sync uploads nothing"

if [ "$LARGE" = true ]; then
  current="large"
  # Shelby allows 3,000 parts per upload, so the part size sets your largest file:
  # 8 MiB (the default) gives about 23 GiB, 64MB about 187 GiB. 5MB parts here make
  # a 12 MiB file upload in 3 parts. (The CLI's MB means MiB.)
  aws configure set s3.multipart_threshold 5MB --profile shelby
  aws configure set s3.multipart_chunksize 5MB --profile shelby
  head -c $((12 * 1024 * 1024)) /dev/urandom >"$tmp/large.bin"
  aws_or_fail s3 cp "$tmp/large.bin" "s3://$BUCKET/$prefix/large.bin" --only-show-errors
  written="$written $prefix/large.bin"
  aws_or_fail s3api head-object --bucket "$BUCKET" --key "$prefix/large.bin" \
    --query ETag --output text >"$tmp/etag"
  aws_or_fail s3 cp "s3://$BUCKET/$prefix/large.bin" "$tmp/large-copy.bin" --only-show-errors
  if [ "$(sha256 "$tmp/large.bin")" != "$(sha256 "$tmp/large-copy.bin")" ]; then
    fail "the downloaded file doesn't match" "report this in Discord"
  fi
  ok "12 MiB in 5 MiB parts (ETag $(tr -d '"' <"$tmp/etag")), downloaded and matched"
fi

current="delete"
# Delete the keys this run wrote. Tracking them, rather than listing the prefix (as
# aws s3 rm --recursive does), avoids missing objects that haven't reached the
# listing yet.
write_delete_request
aws_or_fail s3api delete-objects --bucket "$BUCKET" --delete "file://$tmp/delete.json" \
  --output json >"$tmp/deleted"
if grep -q '"Errors"' "$tmp/deleted"; then
  fail "some deletes failed: $(tr -d '\n ' <"$tmp/deleted")" "see $DOCS/troubleshooting"
fi
count=0
for key in $written; do
  if aws s3api head-object --bucket "$BUCKET" --key "$key" >/dev/null 2>"$tmp/stderr"; then
    fail "$key still exists after delete" "report this in Discord"
  fi
  grep -q -e '404' -e 'Not Found' "$tmp/stderr" || explain_and_fail "$tmp/stderr"
  count=$((count + 1))
done
written=""
ok "deleted $count object(s), HEAD confirms they're gone"
