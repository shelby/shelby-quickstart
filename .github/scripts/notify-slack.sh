#!/usr/bin/env bash
# Post verify's result to Slack: every failure, and the first pass after a failure.
# Green runs that follow green runs stay quiet.
#
# Runs as the last job of verify.yml. Reads:
#   SLACK_WEBHOOK_URL   the incoming webhook; without it, nothing is posted
#   RESULT              failure or success, for the run as a whole
#   DOCTOR_RESULT       the doctor job's result
#   GH_TOKEN and the GITHUB_* variables Actions sets
# DRY_RUN=1 prints the message instead of posting it.
set -euo pipefail

if [ -z "${SLACK_WEBHOOK_URL:-}" ] && [ -z "${DRY_RUN:-}" ]; then
  echo "SLACK_WEBHOOK_URL isn't set; not posting"
  exit 0
fi

repo="$GITHUB_REPOSITORY"
run_url="$GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID"
case "$GITHUB_EVENT_NAME" in
schedule) trigger="the nightly run" ;;
push) trigger="a push to $GITHUB_REF_NAME" ;;
workflow_dispatch) trigger="a manual run by $GITHUB_ACTOR" ;;
*) trigger="a $GITHUB_EVENT_NAME run" ;;
esac

if [ "$RESULT" = failure ]; then
  # Job logs are available once a job finishes, even while this run is in progress.
  # The examples print "FAIL <step>: <cause> -> <fix>", and doctor prints
  # "FAIL <check>  <cause> -> <fix>". Quote the first from each failed job.
  failed="" details=""
  while IFS=$'\t' read -r id name; do
    [ -n "$id" ] || continue
    failed="${failed:+$failed, }$name"
    line=$(gh api "repos/$repo/actions/jobs/$id/logs" 2>/dev/null |
      grep -oE 'FAIL [a-z0-9-]+[: ].*' | head -1 | tr -s ' ' || true)
    if [ -n "$line" ]; then details="${details:+$details$'\n'}$name: $line"; fi
  done < <(gh api "repos/$repo/actions/runs/$GITHUB_RUN_ID/jobs" --paginate \
    --jq '.jobs[] | select(.conclusion == "failure") | "\(.id)\t\(.name)"')

  if [ "$DOCTOR_RESULT" = failure ]; then
    hint="doctor failed, so check the CI account's credentials and the endpoint first."
  else
    hint="doctor passed, so an example broke: look for a platform change or a client update."
  fi
  text=":red_circle: *shelby-quickstart verify failed* on $trigger. <$run_url|View the run>"
  text="$text"$'\n'"Failed: ${failed:-see the run}"$'\n'"$hint"
  if [ -n "$details" ]; then text="$text"$'\n```\n'"$details"$'\n```'; fi
else
  previous=$(gh run list --repo "$repo" --workflow verify.yml --branch "$GITHUB_REF_NAME" \
    --status completed --limit 10 --json databaseId,conclusion,event \
    --jq "[.[] | select(.databaseId != $GITHUB_RUN_ID and .event != \"pull_request\")][0].conclusion // \"\"")
  if [ "$previous" != failure ]; then
    echo "passed after a run that didn't fail; not posting"
    exit 0
  fi
  text=":large_green_circle: *shelby-quickstart verify is passing again* on $trigger. <$run_url|View the run>"
fi

payload=$(jq -n --arg text "$text" '{text: $text}')
if [ -n "${DRY_RUN:-}" ]; then
  echo "$payload"
  exit 0
fi
curl -fsS -X POST -H 'Content-Type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL" >/dev/null
echo "posted to Slack"
