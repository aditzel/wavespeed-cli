# Protected Janus ordinary CI preparation

Automatic GitHub Actions remains enabled and authoritative. This prepares the
two ordinary jobs from `.github/workflows/test.yml`; it does not commission a
Buildkite provider or change release, npm publishing, Junie or application behavior.

The proposed project is `wavespeed-cli-ci`, repository `aditzel/wavespeed-cli`.
The provider must start the image-owned `janus-ci bootstrap` command on queue
`janus-linux`. `.buildkite/pipeline.yml` is a review reference, not a pipeline to
upload from an untrusted checkout. Source admission and approved commands belong
to the protected image manifest.

| Job | Approved repository command | Dependency | Timeout |
| --- | --- | --- | --- |
| `test` | `bash scripts/buildkite/check.sh test` | none | 360 minutes |
| `validate-implementation` | `bash scripts/buildkite/check.sh validate-implementation` | successful `test` | 360 minutes |

Both jobs require Bun **1.3.14**, plus the image's Python 3 supervisor and Node 22
baseline. The 360-minute limits preserve the original Actions default. Neither
ordinary job has an artifact-upload or release handoff contract.

## Commands and isolation

Both lanes run `bun install --frozen-lockfile` and `bun run build`. `test` then
runs `bun test`, the executable's top-level help, and help for `generate`, `edit`,
`generate-sequential` and `edit-sequential`. `validate-implementation` checks
sync-mode help for all four commands, file-path help for both edit commands, and
the original missing-prompt, missing-images and invalid-size failures. Expected
validation errors must return nonzero and contain the expected message; a shell
pipeline cannot mask the exit status. Only those three invalid commands receive
the existing synthetic `WAVESPEED_API_KEY=test-key` value.

The wrapper rejects inherited API keys, paid live-test activation, standard Bun
dotenv files (including dangling symlinks), and active project Wavespeed config
files before running Bun. Each command receives a small allowlisted environment
with a new temporary HOME, TMPDIR and package caches. Host configuration, custom
API endpoints and inherited credentials are excluded. Public dependency downloads
are required; ordinary checks do not need a paid API, account or publication key.

Commands run in separate process groups. TERM/INT stops the active group, escalates
to KILL after 0.5 seconds, preserves exit 143/130, prevents subsequent stages, and
removes temporary state. Ordinary completion also terminates surviving group
members. The protected controller still owns exhaustive job-UID cleanup for code
that deliberately escapes its process group; this wrapper is not a hostile-code
sandbox.

## Hosted fallback and original workflows

Pushes to `main`/`develop` and pull requests targeting `main` retain their original
triggers, commands and `test` → `validate-implementation` dependency. All ordinary
Actions events temporarily use hosted Ubuntu 24.04 because the previous self-hosted
runners are retired. Fork PRs and explicit `workflow_dispatch` runs remain hosted
after the separate native cutover.
The ordinary workflow grants only `contents: read`, and both checkouts disable
credential persistence. Fork routing is not a runner-access security boundary:
review workflow changes before approving outside-contributor runs, and enforce
trusted-source admission in the Janus controller.

`.github/workflows/release.yml` and `.github/workflows/junie.yml` remain unchanged.
The separate, unpublished release-test preparation is parked locally and is not
part of this ordinary CI PR. No release-test mode or publication operation is
added here.

## Verification and remaining gates

`bun test tests/ci/buildkite-check.test.ts` covers exact command order, stage
failure status, invalid-input assertions, environment/config rejection, temporary
state cleanup, and real TERM/INT with signal-ignoring children and grandchildren.
The PR records red-before-green isolation regressions and frozen-source execution
of both complete ordinary lanes as UID/GID 10001 in restricted Janus containers.
Supplemental real CLI checks deny network syscalls while exercising all three
invalid-input cases; a positive control verifies network denial is active.

Execution evidence identifies the immutable source archive and image
`sha256:d684bb4916fb101be06166ad51b0c27cb74013f04d139da5d52cddb59f0e46cb`.
Every exported blob and mode is compared with the committed source. The containers
have read-only roots, all capabilities dropped, no-new-privileges, a 2 CPU / 8 GiB /
512 PID limit, disposable storage, and no host bind mounts, credentials or sockets.

Hosted manual execution and native Buildkite commissioning remain parent-owned
gates: verify both dependent jobs, exact source identity, trusted/fork admission,
status reporting, retries, cancellation, main/develop runs and rollback before
cutover. Keep automatic Actions enabled until those checks pass.
