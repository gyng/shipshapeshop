#!/usr/bin/env bash
# Optional: create a Cloudflare billing-usage alert via the API, so changes stay "in code" (no dashboard
# clicking, no Terraform). Only meaningful on the **paid** plan — on the free plan your spend is already
# capped at $0 (requests throttle instead of billing), so you don't need this.
#
# Cloudflare has no hard spend cap; this only *notifies* you. Confirm the exact alert type for your account
# under Dashboard → Notifications (the slug below may differ by account/product).
#
# Usage:
#   CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=yyy ALERT_EMAIL=you@example.com ./scripts/set-billing-alert.sh
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
: "${ALERT_EMAIL:?set ALERT_EMAIL}"

curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<JSON | { command -v jq >/dev/null && jq . || cat; }
{
  "name": "shape-gacha-relay billing usage alert",
  "alert_type": "billing_usage_alert",
  "enabled": true,
  "mechanisms": { "email": [{ "id": "${ALERT_EMAIL}" }] }
}
JSON
