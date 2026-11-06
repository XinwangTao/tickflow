#!/usr/bin/env bash
# Verify Cloudflare R2 credentials, bucket access and Android CORS.
# Required env: R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
# Optional: R2_PREFIX (default tickflow/verify)
set -euo pipefail

for name in R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then
    echo "missing env: $name" >&2
    exit 2
  fi
done

endpoint="${R2_ENDPOINT%/}"
bucket="$R2_BUCKET"
prefix="${R2_PREFIX:-tickflow/verify}"
key="$prefix/cors-check-$(date +%s).txt"
url="$endpoint/$bucket/$key"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

auth=(--aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY")
curl_common=(curl -sS --fail-with-body --connect-timeout 15 --max-time 60)

echo "1/4 PUT   $key"
printf 'tickflow cors check\n' > "$tmp/body.txt"
"${curl_common[@]}" "${auth[@]}" -X PUT \
  -H 'Content-Type: text/plain' --data-binary @"$tmp/body.txt" "$url" -o /dev/null

echo "2/4 GET   $key"
"${curl_common[@]}" "${auth[@]}" "$url" -o "$tmp/got.txt"
cmp -s "$tmp/body.txt" "$tmp/got.txt" || { echo "FAIL: GET body mismatch" >&2; exit 1; }

echo "3/4 CORS  preflight from https://localhost"
headers="$tmp/headers.txt"
status=$(curl -sS --connect-timeout 15 --max-time 60 -D "$headers" -o /dev/null \
  -w '%{http_code}' -X OPTIONS "$url" \
  -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type')
if [ "$status" -ge 400 ] || ! grep -qi '^access-control-allow-origin: https://localhost' "$headers"; then
  echo "FAIL: bucket CORS does not allow https://localhost (HTTP $status)" >&2
  grep -i '^access-control-' "$headers" >&2 || true
  exit 1
fi

echo "4/4 DELETE $key"
"${curl_common[@]}" "${auth[@]}" -X DELETE "$url" -o /dev/null

echo "PASS: R2 credentials, object R/W and Android CORS are valid."
