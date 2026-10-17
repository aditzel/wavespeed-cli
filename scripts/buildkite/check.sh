#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ( "$1" != "test" && "$1" != "validate-implementation" ) ]]; then
  echo "Usage: $0 {test|validate-implementation}" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ "$(bun --version)" != "1.3.14" ]]; then
  echo "CI requires Bun 1.3.14." >&2
  exit 1
fi

if [[ "${WAVESPEED_LIVE_E2E:-}" == "1" ]]; then
  echo "CI does not enable paid live API tests." >&2
  exit 1
fi

export CI=true

# Each protected job starts in a fresh checkout.
bun install --frozen-lockfile
bun run build

if [[ "$1" == "test" ]]; then
  bun test
  ./dist/index.js --help
  for command in generate edit generate-sequential edit-sequential; do
    ./dist/index.js "$command" --help
  done
  exit 0
fi

for command in generate edit generate-sequential edit-sequential; do
  help_output="$(./dist/index.js "$command" --help)"
  grep -q "sync.*mode" <<< "$help_output"
done

for command in edit edit-sequential; do
  help_output="$(./dist/index.js "$command" --help)"
  grep -q "file paths" <<< "$help_output"
done

expect_validation_error() {
  local expected="$1"
  local output
  shift

  # Invalid input must fail before API access. Keep the original dummy key
  # scoped to these three checks and handle their expected nonzero exits.
  if output="$(WAVESPEED_API_KEY=test-key ./dist/index.js "$@" 2>&1)"; then
    echo "Expected validation to reject: $*" >&2
    return 1
  fi
  if ! grep -Fq "$expected" <<< "$output"; then
    echo "Expected validation message: $expected" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
}

expect_validation_error "Prompt is required" edit
expect_validation_error "Images are required" edit -p "test"
expect_validation_error "Size must be WIDTH" edit -p "test" -i "https://example.com/test.jpg" -s "invalid"
