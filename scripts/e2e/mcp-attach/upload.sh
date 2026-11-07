#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf '%s\n' 'Usage: upload.sh <url-config-file> <file> <content-type>' >&2
  exit 2
fi
if [[ ! -f "$1" ]] || ! head -c 15 -- "$1" | grep -q '^url = "https://'; then
  printf '%s\n' 'The first argument must be an existing HTTPS curl URL config file.' >&2
  exit 2
fi

# Arm deletion only after checking the config: swapped arguments must never delete media.
url_config=$1
cleanup() {
  rm -f -- "$url_config"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# -q must come first: ignore ~/.curlrc (which could enable tracing or redirects).
# The URL stays in the private config, never in argv. Response bodies are discarded.
curl -q -sS --fail -X PUT -K "$url_config" \
  -H "content-type: $3" -H "x-content-type: $3" \
  --data-binary "@$2" -o /dev/null -w '%{http_code}\n'
