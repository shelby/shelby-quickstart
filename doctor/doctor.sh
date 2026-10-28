#!/usr/bin/env bash
# Check that this machine can reach Shelby's S3 API with your credentials.
#
#   make doctor
#   or: set -a; . ./.env; set +a; bash doctor/doctor.sh
#
# Reads SHELBY_ACCESS_KEY_ID, SHELBY_SECRET_ACCESS_KEY, SHELBY_BUCKET and the optional
# SHELBY_S3_ENDPOINT from the environment. It only reads: nothing is written to your
# bucket. Needs bash and curl 7.75 or later.
#
# Each line starts with ok, warn, skip or FAIL. Exits 1 if any check fails.
set -uo pipefail

ENDPOINT="${SHELBY_S3_ENDPOINT:-https://s3.beta.shelby.xyz}"
ENDPOINT="${ENDPOINT%/}"
REGION="default"
CONSOLE="https://console.shelby.xyz"
DOCS="https://docs.shelby.xyz/tools/s3-gateway"

key_id="${SHELBY_ACCESS_KEY_ID:-}"
secret="${SHELBY_SECRET_ACCESS_KEY:-}"
bucket="${SHELBY_BUCKET:-}"
failures=0
can_sign=true

report() { # status, check, message
  printf '%-4s %-9s %s\n' "$1" "$2" "$3"
  if [ "$1" = FAIL ]; then failures=$((failures + 1)); fi
}

version_ge() { # have, want: true when have >= want
  local IFS=.
  local -a have want
  read -r -a have <<<"$1"
  read -r -a want <<<"$2"
  local i a b
  for i in 0 1 2; do
    a="${have[i]:-0}"
    b="${want[i]:-0}"
    a="${a%%[!0-9]*}"
    b="${b%%[!0-9]*}"
    if [ "${a:-0}" -gt "${b:-0}" ]; then return 0; fi
    if [ "${a:-0}" -lt "${b:-0}" ]; then return 1; fi
  done
  return 0
}

# A signed GET. The credentials go to curl on stdin, so they never appear in the
# process list. Sets $status and $body.
signed_get() { # path and query
  local out user="$key_id:$secret"
  user="${user//\\/\\\\}" # escape for curl's config syntax
  user="${user//\"/\\\"}"
  if ! out=$(printf 'user = "%s"\n' "$user" | curl -sS -K - \
    --max-time 20 --aws-sigv4 "aws:amz:$REGION:s3" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
    -w '\n%{http_code}' "$ENDPOINT$1" 2>&1); then
    status=000
    body="$out"
    return
  fi
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
}

# Shelby rejects bad credentials with a plain-text 401 before the S3 layer, so the
# message text is the only clue. Map each one to its fix.
explain_401() {
  case "$1" in
  *"Invalid S3 credential"*)
    echo "the access key ID or secret is wrong, or they come from different keys -> copy both again from $CONSOLE. If you just created the key, wait a minute and retry" ;;
  *"API key not found"*)
    echo "the gateway didn't recognise an SHLB access key ID and fell back to the older scheme -> set SHELBY_ACCESS_KEY_ID to the SHLB value from $CONSOLE" ;;
  *"Request timestamp is too far"*)
    echo "your clock is 15 minutes or more off -> turn on automatic time sync" ;;
  *"Invalid signature"*)
    echo "the secret doesn't match the access key ID, or something rewrote a signed header -> copy SHELBY_SECRET_ACCESS_KEY again from $CONSOLE" ;;
  *)
    echo "$1 -> see $DOCS/troubleshooting#authentication-errors" ;;
  esac
}

# ---------- environment ------------------------------------------------------

missing=""
[ -n "$key_id" ] || missing="$missing SHELBY_ACCESS_KEY_ID"
[ -n "$secret" ] || missing="$missing SHELBY_SECRET_ACCESS_KEY"
[ -n "$bucket" ] || missing="$missing SHELBY_BUCKET"

# Copy-paste damage that makes a correct credential fail to sign.
check_pasted() { # name, value
  case "$2" in
  *$'\r'*)
    report FAIL env "$1 ends with a carriage return (Windows line endings?) -> save .env with LF line endings"
    can_sign=false ;;
  *[[:space:]]*)
    report FAIL env "$1 contains whitespace -> remove any spaces around the value"
    can_sign=false ;;
  *\"* | *\'*)
    report FAIL env "$1 contains quote characters -> remove the extra quotes"
    can_sign=false ;;
  esac
}

if [ -n "$missing" ]; then
  report FAIL env "missing:$missing -> copy .env.example to .env and fill it in from $CONSOLE"
  can_sign=false
else
  check_pasted SHELBY_ACCESS_KEY_ID "$key_id"
  check_pasted SHELBY_SECRET_ACCESS_KEY "$secret"
  check_pasted SHELBY_BUCKET "$bucket"
  case "$key_id" in
  SHLB*) report ok env "SHELBY_ACCESS_KEY_ID starts with SHLB (${#key_id} characters; the secret is ${#secret})" ;;
  *)
    report FAIL env "SHELBY_ACCESS_KEY_ID doesn't start with SHLB -> use the access key ID from $CONSOLE (the API key goes in SHELBY_SECRET_ACCESS_KEY)"
    can_sign=false
    ;;
  esac
  if [ "$key_id" = "$secret" ]; then
    report FAIL env "SHELBY_ACCESS_KEY_ID and SHELBY_SECRET_ACCESS_KEY are the same value -> the secret is the value the console calls your API key"
    can_sign=false
  fi
  if [[ "$bucket" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    report warn env "SHELBY_BUCKET is your account address -> the gateway still accepts it, but use the bucket name from $CONSOLE"
  elif [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
    report ok env "SHELBY_BUCKET is a valid bucket name ($bucket)"
  else
    report FAIL env "SHELBY_BUCKET '$bucket' isn't a valid S3 bucket name -> copy your bucket name from $CONSOLE"
  fi
fi

# ---------- endpoint and clock -----------------------------------------------

if ! curl --help all 2>/dev/null | grep -q -- '--aws-sigv4'; then
  report FAIL tools "curl $(curl --version | head -1 | cut -d' ' -f2) can't sign requests -> install curl 7.75 or later"
  can_sign=false
fi

if headers=$(curl -sS -I --max-time 15 "$ENDPOINT/" 2>&1); then
  server_date=$(printf '%s\n' "$headers" | tr -d '\r' | sed -n 's/^[Dd]ate: //p' | head -1)
  server_epoch=$(LC_ALL=C date -u -d "$server_date" +%s 2>/dev/null ||
    LC_ALL=C date -u -j -f '%a, %d %b %Y %H:%M:%S GMT' "$server_date" +%s 2>/dev/null || true)
  if [ -n "$server_epoch" ]; then
    skew=$(($(date -u +%s) - server_epoch))
    skew=${skew#-}
    if [ "$skew" -ge 900 ]; then
      report FAIL clock "${skew}s off the server's clock; requests need under 15 minutes -> turn on automatic time sync"
    elif [ "$skew" -ge 60 ]; then
      report warn clock "${skew}s off the server's clock -> turn on automatic time sync before it reaches 15 minutes"
    else
      report ok clock "within ${skew}s of the server"
    fi
  else
    report warn clock "couldn't read the server's Date header; skipped the clock check"
  fi
  report ok endpoint "$ENDPOINT answers"
else
  report FAIL endpoint "can't reach $ENDPOINT: $(printf '%s' "$headers" | head -1) -> check your connection, proxy and SHELBY_S3_ENDPOINT"
  can_sign=false
fi

# ---------- credentials and bucket -------------------------------------------

if [ "$can_sign" = true ]; then
  # ListBuckets returns the one bucket these credentials own.
  signed_get "/"
  case "$status" in
  200)
    owned=$(printf '%s' "$body" | grep -o '<Name>[^<]*</Name>' | sed 's/<[^>]*>//g' | head -1)
    if [ -z "$owned" ]; then
      report warn auth "credentials work, but ListBuckets returned no bucket"
    elif [ "$owned" = "$bucket" ]; then
      report ok auth "credentials work; your bucket is $owned"
    elif [[ "$bucket" =~ ^0x ]]; then
      report ok auth "credentials work; your bucket is named $owned"
    else
      report FAIL auth "SHELBY_BUCKET is '$bucket', but these credentials own '$owned' -> set SHELBY_BUCKET=$owned"
      can_sign=false
    fi
    ;;
  401)
    report FAIL auth "$(explain_401 "$body")"
    can_sign=false
    ;;
  000)
    report FAIL auth "request failed: $body"
    can_sign=false
    ;;
  *)
    report FAIL auth "ListBuckets returned HTTP $status: $(printf '%s' "$body" | head -c 200) -> see $DOCS/troubleshooting"
    can_sign=false
    ;;
  esac
fi

if [ "$can_sign" = true ]; then
  signed_get "/$bucket?list-type=2&max-keys=1"
  case "$status" in
  200) report ok bucket "can list $bucket" ;;
  403) report FAIL bucket "403 AccessDenied: $bucket belongs to another account -> use your own bucket name from $CONSOLE" ;;
  404) report FAIL bucket "404 NoSuchBucket: no bucket named $bucket -> copy your bucket name from $CONSOLE" ;;
  *) report FAIL bucket "ListObjectsV2 returned HTTP $status: $(printf '%s' "$body" | head -c 200)" ;;
  esac
fi

# ---------- tools ------------------------------------------------------------
# Missing tools are skipped, not failed: you only need the ones you use.

if command -v aws >/dev/null; then
  v=$(aws --version 2>&1 | sed -n 's|^aws-cli/\([0-9.]*\).*|\1|p')
  if version_ge "$v" 2.0.0; then
    report ok aws-cli "$v (the example sets request_checksum_calculation = when_required, which 2.23+ needs)"
  else
    report warn aws-cli "$v is AWS CLI v1 -> the examples target v2"
  fi
  if setting=$(aws configure get request_checksum_calculation --profile shelby 2>/dev/null); then
    if [ "$setting" != when_required ]; then
      report warn aws-cli "your 'shelby' profile has request_checksum_calculation = ${setting:-unset} -> set it to when_required, or uploads fail with 501"
    fi
  fi
else
  report skip aws-cli "not installed (needed for make aws-cli)"
fi

if command -v uv >/dev/null; then
  report ok uv "$(uv --version | cut -d' ' -f2) (runs the Python example)"
elif command -v python3 >/dev/null; then
  v=$(python3 -c 'import platform; print(platform.python_version())')
  if version_ge "$v" 3.10.0; then
    report ok python "$v, no uv -> pip install 'boto3>=1.36', then run the example with python3"
  else
    report warn python "$v -> the Python example needs 3.10 or later"
  fi
else
  report skip python "neither uv nor python3 is installed (needed for make python)"
fi

if command -v node >/dev/null; then
  v=$(node --version | tr -d v)
  if version_ge "$v" 22.18.0; then
    report ok node "$v"
  else
    report warn node "$v can't run TypeScript files directly -> install Node 22.18 or later"
  fi
else
  report skip node "not installed (needed for the JavaScript example)"
fi

if command -v rclone >/dev/null; then
  v=$(rclone version 2>/dev/null | head -1 | sed -n 's/^rclone v\([0-9.]*\).*/\1/p')
  if version_ge "$v" 1.60.0; then report ok rclone "$v"; else report warn rclone "$v -> install 1.60 or later"; fi
else
  report skip rclone "not installed (needed for the rclone example)"
fi

if command -v duckdb >/dev/null; then
  v=$(duckdb --version 2>/dev/null | sed -n 's/^v\([0-9.]*\).*/\1/p')
  if version_ge "$v" 1.1.0; then report ok duckdb "$v"; else report warn duckdb "$v -> install 1.1 or later"; fi
else
  report skip duckdb "not installed (needed for the DuckDB example)"
fi

if [ "$failures" -eq 0 ]; then
  echo "RESULT ok"
else
  echo "RESULT fail ($failures check(s) failed)"
  exit 1
fi
