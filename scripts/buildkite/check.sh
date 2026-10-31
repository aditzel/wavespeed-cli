#!/usr/bin/env bash
set -euo pipefail

if ! { [[ $# -eq 1 && ( "$1" == "test" || "$1" == "validate-implementation" || "$1" == "release-test" ) ]] ||
       [[ $# -eq 2 && "$1" == "release-build" && "$2" =~ ^(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})$ ]]; }; then
  echo "Usage: $0 {test|validate-implementation|release-test} | release-build VERSION" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Python is supplied by the reviewed image; -I ignores inherited Python configuration.
exec python3 -I -B - "$@" <<'PY'
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

mode = sys.argv[1]
if os.environ.get("WAVESPEED_LIVE_E2E") == "1" or os.environ.get("WAVESPEED_API_KEY"):
    sys.exit("Ordinary CI rejects inherited API credentials and paid live-test activation.")

# Bun and the CLI load these files implicitly, before command validation.
configuration = [".env", ".env.local", ".env.test", ".env.test.local",
                 ".env.development", ".env.development.local", ".env.production",
                 ".env.production.local", ".wavespeedrc", ".wavespeedrc.json",
                 ".wavespeedrc.yaml", ".wavespeedrc.yml", "wavespeed.config.json",
                 "wavespeed.config.yaml", "wavespeed.config.yml"]
for name in configuration:
    if Path(name).exists() or Path(name).is_symlink():
        sys.exit("Ordinary CI requires a checkout without active dotenv or Wavespeed configuration: " + name)

active = None
canceled = None


class CheckFailure(Exception):
    def __init__(self, code):
        self.code = code


def signal_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def cancel(sig, _frame):
    global canceled
    if canceled is None:
        canceled = sig
    if active is not None:
        signal_group(active.pid, signal.SIGTERM)


signal.signal(signal.SIGTERM, cancel)
signal.signal(signal.SIGINT, cancel)

with tempfile.TemporaryDirectory(prefix="wavespeed-janus-") as state:
    root = Path(state)
    for name in ["home", "tmp", "bun-cache", "npm-cache"]:
        (root / name).mkdir()
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CI": "true",
           "HOME": str(root / "home"), "TMPDIR": str(root / "tmp"),
           "BUN_INSTALL_CACHE_DIR": str(root / "bun-cache"),
           "npm_config_cache": str(root / "npm-cache"),
           "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}

    def run(argv, capture=False, extra=None):
        global active
        if canceled is not None:
            raise CheckFailure(128 + canceled)
        # A file keeps an orphan with an inherited output FD from blocking communicate().
        with tempfile.TemporaryFile() as output:
            active = subprocess.Popen(argv, env=dict(env, **(extra or {})),
                                      start_new_session=True,
                                      stdout=output if capture else None,
                                      stderr=subprocess.STDOUT if capture else None)
            deadline = None
            try:
                while active.poll() is None:
                    if canceled is not None:
                        signal_group(active.pid, signal.SIGTERM)
                        if deadline is None:
                            deadline = time.monotonic() + 0.5
                        if time.monotonic() >= deadline:
                            signal_group(active.pid, signal.SIGKILL)
                    time.sleep(0.02)
                code = active.wait()
            finally:
                # Also remove descendants surviving an ordinary successful/failed command.
                signal_group(active.pid, signal.SIGTERM)
                time.sleep(0.2)
                signal_group(active.pid, signal.SIGKILL)
                active.wait()
                active = None
            if canceled is not None:
                raise CheckFailure(128 + canceled)
            output.seek(0)
            return (code if code >= 0 else 128 - code), output.read().decode("utf-8", errors="replace")

    def check(argv, capture=False):
        code, output = run(argv, capture)
        if code:
            if output:
                print(output, file=sys.stderr, end="")
            raise CheckFailure(code)
        return output

    try:
        if check(["bun", "--version"], capture=True).strip() != "1.3.14":
            print("CI requires Bun 1.3.14.", file=sys.stderr)
            raise CheckFailure(1)
        if mode == "release-build":
            check(["bun", "scripts/release/build-versioned.mjs", sys.argv[2]])
            sys.exit(0)
        check(["bun", "install", "--frozen-lockfile"])
        check(["bun", "run", "build"])
        commands = ["generate", "edit", "generate-sequential", "edit-sequential"]
        if mode in ("test", "release-test"):
            check(["bun", "test"])
            check(["./dist/index.js", "--help"])
            if mode == "test":
                for command in commands:
                    check(["./dist/index.js", command, "--help"])
        else:
            for command in commands:
                if not re.search(r"sync.*mode", check(["./dist/index.js", command, "--help"], capture=True)):
                    raise CheckFailure(1)
            for command in ["edit", "edit-sequential"]:
                if "file paths" not in check(["./dist/index.js", command, "--help"], capture=True):
                    raise CheckFailure(1)
            cases = [("Prompt is required", ["edit"]),
                     ("Images are required", ["edit", "-p", "test"]),
                     ("Size must be WIDTH", ["edit", "-p", "test", "-i", "https://example.com/test.jpg", "-s", "invalid"])]
            for expected, args in cases:
                # Only these deliberately invalid commands receive the original dummy key.
                code, output = run(["./dist/index.js"] + args, capture=True,
                                   extra={"WAVESPEED_API_KEY": "test-key"})
                if code == 0 or expected not in output:
                    print("Expected offline validation failure: " + expected, file=sys.stderr)
                    raise CheckFailure(1)
                print(expected)
        if canceled is not None:
            raise CheckFailure(128 + canceled)
    except CheckFailure as error:
        sys.exit(error.code)
PY
