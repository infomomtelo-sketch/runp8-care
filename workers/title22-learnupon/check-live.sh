#!/usr/bin/env bash
# Proves the deployed title22-learnupon Worker is live and refusing what it
# should. Run by deploy-title22-learnupon.yml after a deploy and by
# check-title22-learnupon.yml on its own. Needs no secret: it reads /health
# (yes/no per secret, never a value) and sends one UNSIGNED post, which must be
# refused and writes nothing.
#
# A brand-new workers.dev address takes a while to go live (Cloudflare answers
# "error code: 1042" until it does), so this waits for it instead of testing
# once after a few seconds — the first deploy failed exactly that way.
set -u
BASE="${BASE:-https://title22-learnupon.infomomtelo.workers.dev}"
TRIES="${TRIES:-36}"   # x 5s = 3 minutes
OUT="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

body=""
for i in $(seq 1 "$TRIES"); do
  body=$(curl -sS -m 10 "$BASE/health" 2>&1 || true)
  if echo "$body" | grep -q '"accepts"'; then break; fi
  echo "attempt $i: not live yet: $body"
  sleep 5
done

unsigned=$(curl -sS -m 10 -o /tmp/unsigned.json -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d '{"data":[]}' "$BASE/api/learnupon/webhook" 2>&1 || true)

{
  echo "### title22-learnupon live check"
  echo "Health (\`GET $BASE/health\`):"
  echo '```'
  echo "$body"
  echo '```'
  echo "Unsigned POST to the webhook: HTTP \`$unsigned\` \`$(cat /tmp/unsigned.json 2>/dev/null)\`"
  echo ""
  echo "Webhook address for the partner portal: $BASE/api/learnupon/webhook"
} >> "$OUT"
echo "health: $body"
echo "unsigned POST: $unsigned $(cat /tmp/unsigned.json 2>/dev/null)"

echo "$body" | grep -q '"accepts"' || { echo "::error::Health never answered from the Worker after $TRIES tries."; exit 1; }
# 401 once the secrets are set, 503 before: either way it refused and wrote nothing.
case "$unsigned" in
  401|503) echo "Refused the unsigned post, as it should." ;;
  *) echo "::error::Unsigned post was not refused (HTTP $unsigned)."; exit 1 ;;
esac
