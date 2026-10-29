#!/usr/bin/env bash
# Write Parquet and CSV to Shelby from DuckDB, then query them in place.
#
#   make duckdb [ARGS=--large]
#   or: set -a; . ./.env; set +a; bash clients/duckdb/quickstart.sh [--large]
#
# Everything it writes goes under quickstart/duckdb/<run-id>/ in your bucket and is
# deleted at the end, even if a step fails. DuckDB can't delete objects, so cleanup
# uses curl's built-in AWS signing. Needs DuckDB 1.1 or later, and curl 7.75 or later.
# Exits 0 only when every step passes.
set -euo pipefail

ENDPOINT="${SHELBY_S3_ENDPOINT:-https://s3.beta.shelby.xyz}"
ENDPOINT="${ENDPOINT%/}"
CONSOLE="https://console.shelby.xyz"
DOCS="https://docs.shelby.xyz/tools/s3-gateway"
LARGE=false
if [ "${1:-}" = --large ]; then LARGE=true; fi

# Deterministic sample data, so the totals read back from Shelby can be checked
# against the same query run locally.
READINGS="CREATE TABLE readings AS
  SELECT i AS id, 2023 + i % 3 AS year, round(((i * 7919) % 1000) / 10.0, 1) AS value
  FROM range(3000) t(i);"
BIG="CREATE TABLE big AS SELECT i AS id, hash(i) AS h FROM range(1500000) t(i);"

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

# Map a DuckDB or curl error (its stderr, in a file) to a FAIL line with a fix.
explain_and_fail() {
  local msg
  msg=$(tr -d '\r' <"$1" | grep -v '^$' | head -1)
  case "$msg" in
  *401* | *Unauthorized*) fail "401 Unauthorized" "run make doctor, which shows the reason" ;;
  *403* | *AccessDenied*) fail "403 AccessDenied" "SHELBY_BUCKET must be your own bucket" ;;
  *NoSuchBucket*) fail "404 NoSuchBucket" "copy your bucket name from $CONSOLE" ;;
  *501* | *NotImplemented*) fail "501: $msg" "Shelby doesn't support this call; see $DOCS/compatibility" ;;
  *) fail "${msg:-DuckDB failed}" "see $DOCS/troubleshooting" ;;
  esac
}

# Run SQL against Shelby. The setup statements' output is discarded, and the query
# output lands in $tmp/out. duck_run returns DuckDB's exit status; duck fails the step.
duck_run() {
  duckdb -batch -bail -noheader -list >"$tmp/out" 2>"$tmp/stderr" <<SQL
.output /dev/null
$SETUP
.output
$1
SQL
}
duck() { duck_run "$1" || explain_and_fail "$tmp/stderr"; }

# Run SQL locally, with no connection to Shelby.
duck_local() { duckdb -batch -bail -noheader -list -c "$1"; }

# A signed request with curl, for what DuckDB can't do. The credentials go to curl
# on stdin, so they stay out of the process list. Sets $status; headers land in
# $tmp/headers.
signed() { # method, key
  local user="$SHELBY_ACCESS_KEY_ID:$SHELBY_SECRET_ACCESS_KEY"
  user="${user//\\/\\\\}" # escape for curl's config syntax
  user="${user//\"/\\\"}"
  local args=(-sS -o /dev/null -D "$tmp/headers" -w '%{http_code}' --max-time 30
    --aws-sigv4 "aws:amz:default:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD")
  if [ "$1" = HEAD ]; then args+=(-I); else args+=(-X "$1"); fi
  # SigV4 needs = encoded in the path, as in the year=2023 partition keys.
  status=$(printf 'user = "%s"\n' "$user" |
    curl -K - "${args[@]}" "$ENDPOINT/$BUCKET/${2//=/%3D}" 2>"$tmp/stderr") || status=000
}

on_exit() {
  local status=$? key
  if [ -n "$written" ] && [ -n "$tmp" ]; then
    for key in $written; do signed DELETE "$key" || true; done
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
command -v duckdb >/dev/null || fail "DuckDB isn't installed" "install DuckDB 1.1 or later: https://duckdb.org/docs/installation/"

current="setup"
BUCKET="$SHELBY_BUCKET"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/shelby-quickstart.XXXXXX") # macOS ignores TMPDIR without a template
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
prefix="quickstart/duckdb/$run_id"
base="s3://$BUCKET/$prefix"

# DuckDB's ENDPOINT takes a host, not a URL.
case "$ENDPOINT" in
http://*) host="${ENDPOINT#http://}" use_ssl=false ;;
*) host="${ENDPOINT#https://}" use_ssl=true ;;
esac

SETUP="INSTALL httpfs;
LOAD httpfs;
-- A temporary secret: it lasts for this session and is never written to disk.
-- getenv keeps the credentials out of the SQL text.
CREATE SECRET shelby (
    TYPE s3,
    KEY_ID getenv('SHELBY_ACCESS_KEY_ID'),
    SECRET getenv('SHELBY_SECRET_ACCESS_KEY'),
    REGION 'default',
    ENDPOINT '$host',
    USE_SSL $use_ssl,
    -- Required: the endpoint doesn't serve bucket names as hostnames.
    URL_STYLE 'path'
);
-- Shelby allows 3,000 parts per upload. DuckDB sizes its upload parts from this
-- setting, so large files stay within the limit.
SET s3_uploader_max_parts_per_file = 3000;"

expected_total=$(duck_local "$READINGS SELECT count(*), round(sum(value), 1) FROM readings;")
expected_by_year=$(duck_local "$READINGS SELECT year, count(*), round(sum(value), 1) FROM readings GROUP BY year ORDER BY year;")
ok "DuckDB $(duckdb --version | cut -d' ' -f1), sample data ready"

# ---------- steps ------------------------------------------------------------

current="write"
# RETURN_FILES reports every file a COPY wrote, so this run can track its keys
# without listing them.
duck "$READINGS
COPY readings TO '$base/readings.parquet' (FORMAT parquet, RETURN_FILES true);
COPY readings TO '$base/readings.csv' (FORMAT csv, RETURN_FILES true);
COPY readings TO '$base/by_year' (FORMAT parquet, PARTITION_BY (year), RETURN_FILES true);"
grep -o "s3://$BUCKET/[^]', ]*" "$tmp/out" | sed "s|^s3://$BUCKET/||" >"$tmp/keys" || true
while read -r key; do written="$written $key"; done <"$tmp/keys"
count=$(echo "$written" | wc -w | tr -d ' ')
if [ "$count" -ne 5 ]; then
  fail "expected 5 files written, DuckDB reported $count: $(tr '\n' ' ' <"$tmp/out")" "report this in Discord"
fi
ok "readings.parquet, readings.csv and 3 hive partitions written from DuckDB"

current="read"
# Reads see new objects as soon as the write returns.
duck "SELECT count(*), round(sum(value), 1) FROM read_parquet('$base/readings.parquet');
SELECT count(*), round(sum(value), 1) FROM read_csv('$base/readings.csv');"
if [ "$(cat "$tmp/out")" != "$(printf '%s\n%s' "$expected_total" "$expected_total")" ]; then
  fail "totals don't match: got $(tr '\n' ' ' <"$tmp/out"), expected $expected_total" "report this in Discord"
fi
ok "Parquet and CSV queried in place, totals match ($expected_total)"

current="glob"
# A glob lists the bucket, and listings lag writes by a few seconds, so retry until
# every partition shows up.
glob="SELECT year, count(*), round(sum(value), 1)
  FROM read_parquet('$base/by_year/*/*.parquet', hive_partitioning = true)
  GROUP BY year ORDER BY year;"
started=$(date +%s)
while :; do
  if duck_run "$glob"; then
    if [ "$(cat "$tmp/out")" = "$expected_by_year" ]; then break; fi
  elif ! grep -q 'No files found' "$tmp/stderr"; then
    explain_and_fail "$tmp/stderr"
  fi
  if [ $(($(date +%s) - started)) -ge 30 ]; then
    fail "the glob didn't find all 3 partitions after 30s: $(tr '\n' ' ' <"$tmp/out")" "retry; listings usually catch up in seconds"
  fi
  sleep 1
done
ok "a glob over the hive partitions found all 3 years after $(($(date +%s) - started))s"

if [ "$LARGE" = true ]; then
  current="large"
  # DuckDB's part size is s3_uploader_max_filesize / s3_uploader_max_parts_per_file.
  # Lowering the max file size to 16GiB gives ~5.5 MiB parts, so this ~17 MiB file
  # uploads in several parts. Leave it at the 800GB default for real workloads.
  expected_big=$(duck_local "$BIG SELECT count(*), sum(h % 1000) FROM big;")
  duck "SET s3_uploader_max_filesize = '16GiB';
$BIG
COPY big TO '$base/large.parquet' (FORMAT parquet, RETURN_FILES true);"
  written="$written $prefix/large.parquet"
  duck "SELECT count(*), sum(h % 1000) FROM read_parquet('$base/large.parquet');"
  if [ "$(cat "$tmp/out")" != "$expected_big" ]; then
    fail "totals don't match: got $(tr '\n' ' ' <"$tmp/out"), expected $expected_big" "report this in Discord"
  fi
  signed HEAD "$prefix/large.parquet"
  etag=$(tr -d '\r"' <"$tmp/headers" | sed -n 's/^[Ee][Tt]ag: //p')
  size=$(tr -d '\r' <"$tmp/headers" | sed -n 's/^[Cc]ontent-[Ll]ength: //p')
  ok "$((size / 1024 / 1024)) MiB Parquet written in parts (ETag $etag), totals match"
fi

current="delete"
# DuckDB can't delete objects, so this uses curl, one key at a time.
count=0
for key in $written; do
  signed DELETE "$key"
  case "$status" in
  200 | 204) count=$((count + 1)) ;;
  *) fail "DELETE $key returned HTTP $status $(head -1 "$tmp/stderr")" "see $DOCS/troubleshooting" ;;
  esac
done
for key in $written; do
  signed HEAD "$key"
  if [ "$status" != 404 ]; then fail "$key still answers HEAD with $status after delete" "report this in Discord"; fi
done
written=""
ok "deleted $count object(s) with curl, HEAD confirms they're gone"
