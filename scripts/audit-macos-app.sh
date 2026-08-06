#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 /path/to/Colony.app" >&2
  exit 2
fi

app="$1"
expected_team_id="${COLONY_EXPECT_APPLE_TEAM_ID:-}"
require_gatekeeper="${COLONY_REQUIRE_GATEKEEPER:-false}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "$app/Contents" ]]; then
  echo "not a Colony application bundle: $app" >&2
  exit 1
fi
node "$script_dir/mac-bundle-policy.mjs" "$app"

has_entitlement() {
  local path="$1"
  local key="$2"
  local key_path="${key//./\\.}"
  codesign -d --entitlements :- "$path" 2>/dev/null \
    | plutil -extract "$key_path" raw -o - - 2>/dev/null \
    | grep -qx 'true'
}

is_jit_runtime() {
  case "$1" in
    */Contents/MacOS/colony-supervisor|*/Contents/Resources/runtime/node) return 0 ;;
    *) return 1 ;;
  esac
}

signed_count=0
while IFS= read -r -d '' path; do
  if ! file -b "$path" | grep -q 'Mach-O'; then
    continue
  fi
  codesign --verify --strict --verbose=2 "$path"
  signed_count=$((signed_count + 1))
  if is_jit_runtime "$path"; then
    has_entitlement "$path" 'com.apple.security.cs.allow-jit' || {
      echo "JIT runtime is missing allow-jit: $path" >&2
      exit 1
    }
    has_entitlement "$path" 'com.apple.security.cs.allow-unsigned-executable-memory' || {
      echo "JIT runtime is missing unsigned executable memory: $path" >&2
      exit 1
    }
  elif has_entitlement "$path" 'com.apple.security.cs.allow-jit'; then
    echo "non-JIT code unexpectedly has allow-jit: $path" >&2
    exit 1
  fi

  if [[ -n "$expected_team_id" ]]; then
    actual_team_id="$(codesign -dv --verbose=4 "$path" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
    if [[ "$actual_team_id" != "$expected_team_id" ]]; then
      echo "TeamIdentifier mismatch for $path: expected $expected_team_id, got ${actual_team_id:-none}" >&2
      exit 1
    fi
  fi
done < <(find "$app/Contents" -type f -print0)

if [[ "$signed_count" -eq 0 ]]; then
  echo "no Mach-O code found in $app" >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app"
if [[ "$require_gatekeeper" == "true" ]]; then
  spctl --assess --type execute --verbose=4 "$app"
fi
echo "Verified $signed_count signed Mach-O files in $app"
