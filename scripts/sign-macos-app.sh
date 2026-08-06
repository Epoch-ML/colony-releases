#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 /path/to/Colony.app SIGNING_IDENTITY" >&2
  exit 2
fi

app="$1"
identity="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
jit_entitlements="$script_dir/JitRuntimeEntitlements.plist"
app_entitlements="$script_dir/AppEntitlements.plist"

if [[ ! -d "$app/Contents" ]]; then
  echo "not a Colony application bundle: $app" >&2
  exit 1
fi
if [[ -z "$identity" ]]; then
  echo "signing identity is required" >&2
  exit 1
fi

sign_one() {
  local path="$1"
  local args=(--force --sign "$identity" --options runtime)
  if [[ "$identity" != "-" ]]; then args+=(--timestamp); fi
  case "$path" in
    */Contents/MacOS/colony-supervisor|*/Contents/Resources/runtime/node)
      args+=(--entitlements "$jit_entitlements")
      ;;
  esac
  codesign "${args[@]}" "$path"
}

while IFS= read -r -d '' path; do
  if file -b "$path" | grep -q 'Mach-O'; then sign_one "$path"; fi
done < <(find "$app/Contents" -type f -print0)

app_args=(--force --sign "$identity" --options runtime --entitlements "$app_entitlements")
if [[ "$identity" != "-" ]]; then app_args+=(--timestamp); fi
codesign "${app_args[@]}" "$app"
