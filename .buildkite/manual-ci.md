# Buildkite manual CI pilot

The separate [WaveSpeed manual CI pipeline](https://buildkite.com/mirai-forge/wavespeed-cli-manual-ci)
is active on Janus for commissioning. Ordinary push/PR CI remains on
`wavespeed-cli-ci`; its [operations and rollback guide](ci-operations.md) still
applies. Keep the GitHub-hosted manual recovery control until the remaining
manual acceptance gates are complete.

## Start a build

Use **New build** in the manual pipeline with no environment overrides or custom
steps. Select a branch such as `main`, or an explicit `refs/tags/<tag>` reference.
Use `HEAD` to resolve that ref once, or supply a full commit SHA. An explicit
branch commit must belong to the branch; an explicit tag commit must equal the
tag's peeled target. A bare name without a provider tag selects a branch.

The protected controller authenticates the Buildkite creator and current attempt,
freezes the source commit and job graph, and generates the existing CI sequence:

| Job | Dependency | Command allowance | Provider limit |
| --- | --- | --- | --- |
| `test` | none | 360 minutes | 372 minutes |
| `validate-implementation` | current successful `test` attempt | 360 minutes | 372 minutes |

The extra provider allowance covers admission, checkout and finalization. These
are the configured manual limits; the ordinary pipeline retains its separate
360-minute whole-job ceiling. Retrying an admitted job uses the frozen commit,
even if its selected branch or tag subsequently moves or disappears. A stale
successful test attempt cannot authorize validation while its retry is pending
or failed.

The jobs use the same offline CI commands as ordinary CI. They produce protected
artifact indexes identifying the tested source, job attempt and result; they do
not make paid API requests, upload package payloads or publish to npm. Release
and publishing routes are separate. Reader credentials stay in the root
controller and are never passed to repository processes.

## Verified recovery and remaining gates

On 2026-10-25, [manual build 10](https://buildkite.com/mirai-forge/wavespeed-cli-manual-ci/builds/10)
at `5b3a8ac36bcf6f377026fc63aee14f00c9897759` rejected an invalid controller
reader during bootstrap checkout. The denied attempt created no source receipt,
downstream jobs or artifacts. After restoring the approved reader, an in-place
retry passed tests and validation and produced two indexes bound to their
successful job attempts and exact source commit.

This proves bootstrap authentication-denial and retry recovery. It does not prove
network/5xx outages or loss of identity during an executing command. API-origin
creation, remaining timeout/queue/rollback cases and final manual cutover still
need their own live evidence. Green ordinary CI and this pilot result do not
authorize removing the hosted recovery control.
