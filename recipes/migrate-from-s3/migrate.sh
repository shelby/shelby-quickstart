#!/usr/bin/env bash
# Migrate a dataset from Amazon S3 to Shelby with rclone, verify it, then query it.
#
#   make migrate-from-s3
#   or: set -a; . ./.env; set +a; bash recipes/migrate-from-s3/migrate.sh
#
# The source is a public AWS Open Data bucket: NOAA's daily weather records (GHCN-Daily)
# for 1850-1859, 30 Parquet files, about 1 MB, read without AWS credentials. Everything
# it writes goes under quickstart/migrate-from-s3/<run-id>/ in your bucket and is
# deleted at the end, even if a step fails. Uses a throwaway rclone config. Needs
# rclone 1.60 or later. DuckDB 1.1 or later is optional: with it, the run ends by
# querying the copy. Exits 0 only when every step passes.
set -euo pipefail

ENDPOINT="${SHELBY_S3_ENDPOINT:-https://s3.beta.shelby.xyz}"
ENDPOINT="${ENDPOINT%/}"
CONSOLE="https://console.shelby.xyz"
DOCS="https://docs.shelby.xyz/tools/s3-gateway"

SOURCE="source:noaa-ghcn-pds/parquet/by_year"
# rclone filter rules: TMAX, TMIN and PRCP for each year of the 1850s.
FILTER=(--include "/YEAR=185?/ELEMENT={TMAX,TMIN,PRCP}/*.parquet")

# Results go to the original stdout (fd 3), whatever a step redirects.
exec 3>&1
current="env"
reported=false
written="" # keys this run wrote, space-separated
tmp=""

ok() { printf 'ok   %s: %s\n' "$current" "$1" >&3; }
skip() { printf 'skip %s: %s\n' "$current" "$1" >&3; }

fail() { # cause, fix
  printf 'FAIL %s: %s -> %s\n' "$current" "$1" "$2" >&3
  reported=true
  exit 1
}

# Map an rclone or DuckDB error (its stderr, in a file) to a FAIL line with a fix.
explain_and_fail() {
  local msg
  msg=$(tr -d '\r' <"$1" | grep -m1 -E 'ERROR|Failed|Error|error' || tail -1 "$1")
  case "$msg" in
  *"StatusCode: 401"* | *Unauthorized* | *"HTTP 401"*) fail "401 Unauthorized" "run make doctor, which shows the reason" ;;
  *NoSuchBucket*) fail "404 NoSuchBucket" "copy your bucket name from $CONSOLE" ;;
  *"StatusCode: 403"* | *AccessDenied*) fail "403 AccessDenied" "SHELBY_BUCKET must be your own bucket" ;;
  *"StatusCode: 501"* | *NotImplemented*)
    fail "501: $msg" "Shelby has no server-side copy; pass --checksum to copy and sync. See $DOCS/compatibility" ;;
  *) fail "${msg:-the command failed}" "see $DOCS/troubleshooting" ;;
  esac
}

rclone_or_fail() {
  rclone "$@" 2>"$tmp/stderr" || explain_and_fail "$tmp/stderr"
}

# List the files under a Shelby path into $tmp/ls. An empty prefix can report
# "directory not found", which here just means nothing is listed.
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
prefix="quickstart/migrate-from-s3/$run_id"
dest="shelby:$BUCKET/$prefix/ghcn"

current="remotes"
export RCLONE_CONFIG="$tmp/rclone.conf"
touch "$RCLONE_CONFIG"
for var in $(env | sed -n -E 's/^(RCLONE_CONFIG_(SOURCE|SHELBY)_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$var"; done
# The source: Amazon S3, read anonymously. For your own bucket, configure this remote
# with your AWS, R2 or MinIO credentials instead. See README.md.
rclone config create source s3 provider=AWS region=us-east-1 env_auth=false >/dev/null
# The destination: Shelby. config create prints the secret, so its output is discarded.
rclone config create shelby s3 \
  provider=Other \
  endpoint="$ENDPOINT" \
  access_key_id="$SHELBY_ACCESS_KEY_ID" \
  secret_access_key="$SHELBY_SECRET_ACCESS_KEY" \
  region=default \
  force_path_style=true \
  max_upload_parts=3000 >/dev/null
ok "source (Amazon S3, anonymous) and shelby remotes configured"

# ---------- steps ------------------------------------------------------------

current="inventory"
rclone_or_fail lsf -R --files-only "$SOURCE" "${FILTER[@]}" >"$tmp/source-files"
files=$(grep -c . "$tmp/source-files" || true)
if [ "$files" -ne 30 ]; then
  fail "expected 30 source files, found $files" "check that s3://noaa-ghcn-pds is reachable from here"
fi
rclone_or_fail size "$SOURCE" "${FILTER[@]}" --json >"$tmp/size"
bytes=$(sed -n 's/.*"bytes":\([0-9]*\).*/\1/p' "$tmp/size")
ok "$files files, $((bytes / 1024)) KiB in s3://noaa-ghcn-pds/parquet/by_year"

current="copy"
# rclone streams each object through this machine, because Shelby can't copy
# server-side. For a large migration, run it close to the source, for example in the
# same cloud region, to keep transfer costs down.
started=$(date +%s)
rclone_or_fail copy "$SOURCE" "$dest" "${FILTER[@]}" --checksum --transfers 8
while read -r path; do written="$written $prefix/ghcn/$path"; done <"$tmp/source-files"
ok "copied in $(($(date +%s) - started))s"

current="list"
wait_for_listing "$prefix/ghcn" "$files"
ok "all $files files listed after ${waited}s"

current="check"
# Compares sizes, and MD5 hashes wherever both sides have them. Files uploaded in parts
# (over 200 MiB by default) have no whole-file MD5, so for those rclone compares sizes.
if ! rclone check "$SOURCE" "$dest" "${FILTER[@]}" --one-way 2>"$tmp/check"; then
  if grep -q 'differences found' "$tmp/check"; then
    fail "$(grep -m1 'differences found' "$tmp/check" | sed 's/.*NOTICE: *//')" "copy again with --checksum"
  fi
  explain_and_fail "$tmp/check"
fi
ok "every file matches the source by size and MD5"

current="query"
if command -v duckdb >/dev/null; then
  # The same query against the source and the copy. The Shelby secret is scoped to
  # your bucket, so s3://noaa-ghcn-pds is still read anonymously from Amazon S3.
  case "$ENDPOINT" in
  http://*) host="${ENDPOINT#http://}" use_ssl=false ;;
  *) host="${ENDPOINT#https://}" use_ssl=true ;;
  esac
  query() { # base URL
    # DuckDB reads ? in an s3:// URL as the start of a query string, so the glob uses *.
    printf "SELECT YEAR,
  round(avg(DATA_VALUE) FILTER (WHERE ELEMENT = 'TMAX') / 10, 1) AS avg_max_c,
  round(avg(DATA_VALUE) FILTER (WHERE ELEMENT = 'TMIN') / 10, 1) AS avg_min_c,
  count(*) FILTER (WHERE ELEMENT = 'PRCP') AS rain_readings
FROM read_parquet('%s/YEAR=185*/ELEMENT=*/*.parquet', hive_partitioning = true)
WHERE ELEMENT IN ('TMAX', 'TMIN', 'PRCP')
GROUP BY YEAR ORDER BY YEAR;" "$1"
  }
  if ! duckdb -batch -bail -noheader -list >"$tmp/query" 2>"$tmp/stderr" <<SQL; then
.output /dev/null
INSTALL httpfs;
LOAD httpfs;
CREATE SECRET shelby (
    TYPE s3,
    KEY_ID getenv('SHELBY_ACCESS_KEY_ID'),
    SECRET getenv('SHELBY_SECRET_ACCESS_KEY'),
    REGION 'default',
    ENDPOINT '$host',
    USE_SSL $use_ssl,
    URL_STYLE 'path',
    SCOPE 's3://$BUCKET/'
);
SET s3_region = 'us-east-1';
.output
$(query "s3://noaa-ghcn-pds/parquet/by_year")
SELECT '--';
$(query "s3://$BUCKET/$prefix/ghcn")
SQL
    explain_and_fail "$tmp/stderr"
  fi
  from_aws=$(sed '/^--$/,$d' "$tmp/query")
  from_shelby=$(sed '1,/^--$/d' "$tmp/query")
  years=$(printf '%s\n' "$from_shelby" | grep -c . || true)
  if [ "$years" -ne 10 ] || [ "$from_aws" != "$from_shelby" ]; then
    fail "the query over the copy doesn't match the source" "report this in Discord"
  fi
  first=$(printf '%s\n' "$from_shelby" | head -1)
  ok "the same query gives the same answer from Amazon S3 and Shelby: 10 years, ${first%%|*} averaged $(echo "$first" | cut -d'|' -f2)°C max"
else
  skip "DuckDB isn't installed; install it to query the copy in place"
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
wait_for_listing "$prefix" 0
ok "deleted $count object(s), and the listing was empty after ${waited}s"
