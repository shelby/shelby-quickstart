#!/usr/bin/env bash
# Copy, check, sync and delete files on Shelby with rclone.
#
#   make rclone [ARGS=--large]
#   or: set -a; . ./.env; set +a; bash clients/rclone/quickstart.sh [--large]
#
# Everything it writes goes under quickstart/rclone/<run-id>/ in your bucket and is
# deleted at the end, even if a step fails. It uses a throwaway rclone config, so your
# own rclone.conf is never read or changed. Exits 0 only when every step passes.
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

# Map an rclone error (its stderr, in a file) to a FAIL line with a fix.
explain_and_fail() {
  local msg
  msg=$(tr -d '\r' <"$1" | grep -m1 -E 'ERROR|Failed|error' || tail -1 "$1")
  case "$msg" in
  *"StatusCode: 401"* | *Unauthorized*) fail "401 Unauthorized" "run make doctor, which shows the reason" ;;
  *NoSuchBucket*) fail "404 NoSuchBucket" "copy your bucket name from $CONSOLE" ;;
  *"StatusCode: 403"* | *AccessDenied*) fail "403 AccessDenied" "SHELBY_BUCKET must be your own bucket" ;;
  *"StatusCode: 501"* | *NotImplemented*)
    fail "501: $msg" "Shelby has no server-side copy; pass --checksum to copy and sync. See $DOCS/compatibility" ;;
  *) fail "${msg:-rclone failed}" "see $DOCS/troubleshooting" ;;
  esac
}

rclone_or_fail() {
  rclone "$@" 2>"$tmp/stderr" || explain_and_fail "$tmp/stderr"
}

# List the files under $1 into $tmp/ls. An empty prefix can report "directory not
# found", which here just means nothing is listed.
list_files() { # path under the bucket
  if ! rclone lsf -R --files-only "shelby:$BUCKET/$1" >"$tmp/ls" 2>"$tmp/stderr"; then
    grep -q 'directory not found' "$tmp/stderr" || explain_and_fail "$tmp/stderr"
    : >"$tmp/ls"
  fi
  listed=$(grep -c . "$tmp/ls" || true)
}

# Wait until the listing of $1 shows exactly $2 files. Listings lag writes and
# deletes by a few seconds.
wait_for_listing() { # path under the bucket, expected count
  local started
  started=$(date +%s)
  while :; do
    list_files "$1"
    if [ "$listed" -eq "$2" ]; then break; fi
    if [ $(($(date +%s) - started)) -ge 30 ]; then
      fail "$listed file(s) listed after 30s, expected $2" "retry; listings usually catch up in seconds"
    fi
    sleep 1
  done
  waited=$(($(date +%s) - started))
}

on_exit() {
  local status=$? key
  if [ -n "$written" ] && [ -n "$tmp" ]; then
    for key in $written; do rclone deletefile "shelby:$BUCKET/$key" >/dev/null 2>&1 || true; done
    echo "cleanup: deleted the objects left by the failed run" >&3
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
command -v rclone >/dev/null || fail "rclone isn't installed" "install rclone 1.60 or later: https://rclone.org/install/"

current="setup"
BUCKET="$SHELBY_BUCKET"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/shelby-quickstart.XXXXXX") # macOS ignores TMPDIR without a template
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
prefix="quickstart/rclone/$run_id"

current="remote"
# A throwaway config file. RCLONE_CONFIG_SHELBY_* variables would override the
# remote's settings, so clear any that are set.
export RCLONE_CONFIG="$tmp/rclone.conf"
touch "$RCLONE_CONFIG"
for var in $(env | sed -n 's/^\(RCLONE_CONFIG_SHELBY_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$var"; done

# The same command creates a permanent remote. See README.md. It prints the config,
# secret included, so its output is discarded.
rclone config create shelby s3 \
  provider=Other \
  endpoint="$ENDPOINT" \
  access_key_id="$SHELBY_ACCESS_KEY_ID" \
  secret_access_key="$SHELBY_SECRET_ACCESS_KEY" \
  region=default \
  force_path_style=true \
  max_upload_parts=3000 >/dev/null
ok "throwaway shelby remote configured ($(rclone version | head -1))"

# ---------- steps ------------------------------------------------------------

current="copy"
mkdir "$tmp/data"
for n in 1 2 3; do printf 'file %s\n' "$n" >"$tmp/data/file$n.txt"; done
# Always pass --checksum. Without it, rclone compares modification times and, when
# they differ, updates them with a server-side copy, which Shelby doesn't support.
rclone_or_fail copy "$tmp/data" "shelby:$BUCKET/$prefix/data" --checksum
written="$written $prefix/data/file1.txt $prefix/data/file2.txt $prefix/data/file3.txt"
ok "3 files copied to $prefix/data"

current="list"
wait_for_listing "$prefix/data" 3
ok "listed after ${waited}s"

current="check"
if ! rclone check "$tmp/data" "shelby:$BUCKET/$prefix/data" --one-way 2>"$tmp/check"; then
  if grep -q 'differences found' "$tmp/check"; then
    fail "$(grep -m1 'differences found' "$tmp/check" | sed 's/.*NOTICE: *//')" "report this in Discord"
  fi
  explain_and_fail "$tmp/check"
fi
ok "sizes and MD5 hashes match"

current="sync"
rclone_or_fail sync "$tmp/data" "shelby:$BUCKET/$prefix/data" --checksum -v
if grep -q ': Copied' "$tmp/stderr"; then
  fail "a second sync copied files again: $(grep -m1 ': Copied' "$tmp/stderr")" "report this in Discord"
fi
ok "a second sync with --checksum transfers nothing"

current="download"
rclone_or_fail copy "shelby:$BUCKET/$prefix/data" "$tmp/data-copy" --checksum
for n in 1 2 3; do
  if [ "$(sha256 "$tmp/data/file$n.txt")" != "$(sha256 "$tmp/data-copy/file$n.txt")" ]; then
    fail "file$n.txt doesn't match after the round trip" "report this in Discord"
  fi
done
ok "downloaded, SHA-256 matches for all 3 files"

if [ "$LARGE" = true ]; then
  current="large"
  # rclone picks a part size that keeps an upload within max_upload_parts=3000. Here
  # 5M chunks and a 5M cutoff force a 12 MiB file to upload in 3 parts.
  head -c $((12 * 1024 * 1024)) /dev/urandom >"$tmp/large.bin"
  rclone_or_fail copyto "$tmp/large.bin" "shelby:$BUCKET/$prefix/large.bin" \
    --s3-chunk-size 5M --s3-upload-cutoff 5M
  written="$written $prefix/large.bin"
  rclone_or_fail copyto "shelby:$BUCKET/$prefix/large.bin" "$tmp/large-copy.bin"
  if [ "$(sha256 "$tmp/large.bin")" != "$(sha256 "$tmp/large-copy.bin")" ]; then
    fail "the downloaded file doesn't match" "report this in Discord"
  fi
  ok "12 MiB in 5 MiB parts, downloaded and matched"
fi

current="delete"
# Delete the keys this run wrote, one by one. rclone delete and purge find files by
# listing, so they can miss objects that haven't reached the listing yet.
count=0
for key in $written; do
  rclone_or_fail deletefile "shelby:$BUCKET/$key"
  count=$((count + 1))
done
written=""
# Deleted objects can stay listed for a few seconds. Wait for the prefix to list empty.
wait_for_listing "$prefix" 0
ok "deleted $count object(s), and the listing was empty after ${waited}s"
